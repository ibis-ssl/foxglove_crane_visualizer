# API仕様

## 📋 概要

Crane Visualizerパネルは、ROSメッセージングシステムを通じてSVGベースの可視化データを受信・処理します。この文書では、サポートするメッセージ形式、データ構造、および統合のためのAPI仕様を詳細に説明します。

## 📡 ROSトピック仕様

### 1. スナップショットトピック

#### トピック情報
- **デフォルト名**: `/aggregated_svgs`
- **メッセージ型**: `SvgLayerArray`
- **推奨頻度**: 0.1-0.33 Hz（3-10秒間隔）
- **用途**: 完全な状態情報の定期配信

#### メッセージ構造
```yaml
# SvgLayerArray.msg
svg_primitive_arrays: SvgPrimitiveArray[]

---
# SvgPrimitiveArray.msg  
string layer                # 階層パス（例: "field/center_circle"）
string[] svg_primitives     # SVG要素の配列
```

#### 実装例
```python
# Python (rospy)
from your_msgs.msg import SvgLayerArray, SvgPrimitiveArray

def publish_snapshot():
    msg = SvgLayerArray()
    
    # フィールド境界線
    field_layer = SvgPrimitiveArray()
    field_layer.layer = "field/boundary"
    field_layer.svg_primitives = [
        "<rect x='-4500' y='-3000' width='9000' height='6000' stroke='white' fill='none'/>",
        "<circle cx='0' cy='0' r='500' stroke='white' fill='none'/>"
    ]
    
    # ロボット位置
    robots_layer = SvgPrimitiveArray()
    robots_layer.layer = "robots/team_blue"
    robots_layer.svg_primitives = [
        "<circle cx='1000' cy='500' r='90' fill='blue'/>",
        "<circle cx='1500' cy='-200' r='90' fill='blue'/>"
    ]
    
    msg.svg_primitive_arrays = [field_layer, robots_layer]
    snapshot_pub.publish(msg)
```

```cpp
// C++ (roscpp)
#include "your_msgs/SvgLayerArray.h"

void publishSnapshot() {
    your_msgs::SvgLayerArray msg;
    
    // フィールドレイヤー
    your_msgs::SvgPrimitiveArray field_layer;
    field_layer.layer = "field/boundary";
    field_layer.svg_primitives.push_back(
        "<rect x='-4500' y='-3000' width='9000' height='6000' stroke='white' fill='none'/>"
    );
    
    // ロボットレイヤー
    your_msgs::SvgPrimitiveArray robots_layer;
    robots_layer.layer = "robots/team_blue";
    robots_layer.svg_primitives.push_back(
        "<circle cx='1000' cy='500' r='90' fill='blue'/>"
    );
    
    msg.svg_primitive_arrays.push_back(field_layer);
    msg.svg_primitive_arrays.push_back(robots_layer);
    
    snapshot_pub_.publish(msg);
}
```

### 2. 更新トピック

#### トピック情報
- **デフォルト名**: `/visualizer_svgs`
- **メッセージ型**: `SvgUpdateArray`
- **推奨頻度**: 10-50 Hz
- **用途**: レイヤー単位の増分更新

#### メッセージ構造
```yaml
# SvgUpdateArray.msg
updates: SvgLayerUpdate[]

---
# SvgLayerUpdate.msg
string layer                    # 対象レイヤーの階層パス
string operation               # "append", "replace", "clear"
string[] svg_primitives        # 操作対象のSVG要素
```

#### 操作種別の詳細

##### append操作
既存のSVG要素に新要素を追加
```python
# 軌跡ポイントの追加例
update = SvgLayerUpdate()
update.layer = "trajectories/robot_0"
update.operation = "append"
update.svg_primitives = [
    "<circle cx='1200' cy='600' r='3' fill='red'/>"
]
```

##### replace操作
レイヤー全体を新しい内容で置換
```python
# ロボット位置の更新例
update = SvgLayerUpdate()
update.layer = "robots/team_blue/robot_0"
update.operation = "replace"
update.svg_primitives = [
    "<circle cx='1300' cy='700' r='90' fill='blue'/>",
    "<line x1='1300' y1='700' x2='1400' y2='700' stroke='darkblue'/>"
]
```

##### clear操作
レイヤーの全要素を削除
```python
# 古い軌跡のクリア例
update = SvgLayerUpdate()
update.layer = "debug/old_trajectories"
update.operation = "clear"
update.svg_primitives = []  # 空配列
```

#### フォールバック互換の指針
スナップショット不在時にも更新のみで状態を再構築できるよう、以下を推奨します。
- 動的レイヤーは原則 `replace` を用いて「レイヤー完全表現」を送る（自己完結）
- 長尺データ（軌跡など）は `append` を使いつつ、適宜 `clear` や定期的な `replace` で区切る
- これにより、過去時刻へのシークでスナップショットが無くても視覚破綻を回避できます

## 🗂️ データ構造仕様

### TypeScript型定義

```typescript
// スナップショット用
interface SvgLayerArray {
  svg_primitive_arrays: SvgPrimitiveArray[];
}

interface SvgPrimitiveArray {
  layer: string;
  svg_primitives: string[];
}

// 更新用
interface SvgUpdateArray {
  updates: SvgLayerUpdate[];
}

interface SvgLayerUpdate {
  layer: string;
  operation: "append" | "replace" | "clear";
  svg_primitives: string[];
}

// パネル設定
interface PanelConfig {
  backgroundColor: string;
  message: string;
  viewBoxWidth: number;
  aggregatedTopic: string;
  updateTopic: string;
  enableUpdateTopic: boolean;
  maxHistoryDuration: number;
  maxHistorySize: number;
  namespaces: {
    [key: string]: {
      visible: boolean;
      children?: { [key: string]: { visible: boolean; children?: any } };
    };
  };
}
```

## 🎨 SVG要素仕様

### 座標系
- **原点**: フィールド中央 (0, 0)
- **単位**: ミリメートル（mm）
- **X軸**: 右方向が正
- **Y軸**: 上方向が正
- **標準フィールドサイズ**: 12000mm × 9000mm

### サポートするSVG要素

#### 基本図形
```xml
<!-- 円 -->
<circle cx="0" cy="0" r="500" fill="blue" stroke="white" stroke-width="2"/>

<!-- 矩形 -->
<rect x="-1000" y="-500" width="2000" height="1000" fill="red" opacity="0.5"/>

<!-- 線分 -->
<line x1="0" y1="0" x2="1000" y2="1000" stroke="green" stroke-width="3"/>

<!-- 多角形 -->
<polygon points="0,0 500,300 200,800" fill="yellow" stroke="black"/>

<!-- パス -->
<path d="M 100 100 L 300 100 L 200 300 z" fill="purple"/>
```

#### テキスト
```xml
<!-- ラベル表示 -->
<text x="0" y="0" font-family="Arial" font-size="100" fill="white" text-anchor="middle">
  Robot 1
</text>

<!-- 多行テキスト -->
<text x="1000" y="500" font-size="80" fill="cyan">
  <tspan x="1000" dy="0">Speed: 2.5 m/s</tspan>
  <tspan x="1000" dy="90">Angle: 45°</tspan>
</text>
```

#### グループ化
```xml
<!-- 複合要素のグループ化 -->
<g transform="translate(1000,500) rotate(45)">
  <circle r="90" fill="blue"/>
  <line x1="0" y1="0" x2="100" y2="0" stroke="white" stroke-width="3"/>
  <text y="30" font-size="60" fill="white" text-anchor="middle">1</text>
</g>
```

## 🏗️ レイヤー命名規則

### 階層構造の推奨パターン

```
field/                      # 静的フィールド要素
├─ boundary                # フィールド境界線
├─ goals                   # ゴール
├─ center_circle           # センターサークル
├─ penalty_areas           # ペナルティエリア
└─ corner_arcs             # コーナーアーク

robots/                     # ロボット関連
├─ team_blue/              # 青チーム
│  ├─ robot_0             # 個別ロボット
│  ├─ robot_1
│  └─ formations          # フォーメーション表示
├─ team_yellow/            # 黄チーム
└─ referee/                # レフェリーロボット

ball/                       # ボール関連
├─ current_position        # 現在位置
├─ predicted_path          # 予測軌道
└─ velocity_vector         # 速度ベクトル

game_state/                 # 試合状態
├─ score                   # スコア表示
├─ time                    # 時間表示
├─ referee_signals         # レフェリー信号
└─ game_phase              # 試合フェーズ

strategies/                 # 戦術情報
├─ offensive_play          # 攻撃戦術
├─ defensive_play          # 守備戦術
├─ set_plays               # セットプレー
└─ role_assignments        # 役割分担

debug/                      # デバッグ情報
├─ trajectories/           # 軌跡情報
│  ├─ robot_0_path
│  └─ ball_path
├─ ai_decisions/           # AI判断
│  ├─ target_positions
│  └─ decision_tree
├─ sensors/                # センサー情報
│  ├─ vision_confidence
│  └─ communication_status
└─ performance/            # パフォーマンス
   ├─ frame_rate
   └─ processing_time
```

## 📤 発行パターンとベストプラクティス

### スナップショット発行戦略

#### 定期発行
```python
# 5秒間隔での完全状態発行
rate = rospy.Rate(0.2)  # 0.2 Hz = 5秒間隔

while not rospy.is_shutdown():
    publish_complete_state()
    rate.sleep()
```

#### イベント駆動発行
```python
# 重要なゲーム状態変化時に発行
def on_game_state_change(new_state):
    if new_state in ['STOP', 'BALL_PLACEMENT', 'KICKOFF']:
        publish_complete_state()
```

### 更新発行戦略

#### 高頻度更新（推奨）
```python
# 30Hz での動的要素更新
rate = rospy.Rate(30.0)

while not rospy.is_shutdown():
    updates = []
    
    # ロボット位置の更新
    if robot_moved():
        updates.append(create_robot_update())
    
    # ボール位置の更新
    if ball_moved():
        updates.append(create_ball_update())
    
    # 軌跡の追加
    if should_add_trajectory_point():
        updates.append(create_trajectory_append())
    
    if updates:
        publish_updates(updates)
    
    rate.sleep()
```

#### 変化検出ベース
```python
# 変化があった要素のみ更新
def on_robot_position_change(robot_id, new_pos):
    update = SvgLayerUpdate()
    update.layer = f"robots/team_blue/robot_{robot_id}"
    update.operation = "replace"
    update.svg_primitives = [create_robot_svg(new_pos)]
    
    publish_single_update(update)
```

## 🔧 統合例

### ROS launchファイル
```xml
<launch>
  <!-- Crane Visualizer用のトピック発行 -->
  <node name="svg_aggregator" pkg="your_package" type="svg_aggregator_node">
    <param name="snapshot_topic" value="/aggregated_svgs"/>
    <param name="snapshot_rate" value="0.2"/>
    <param name="update_topic" value="/visualizer_svgs"/>
    <param name="update_rate" value="30.0"/>
  </node>
  
  <!-- 既存のシステムとの統合 -->
  <node name="ssl_vision_adapter" pkg="your_package" type="vision_adapter">
    <remap from="vision_input" to="/ssl_vision/vision"/>
    <remap from="svg_output" to="/visualizer_svgs"/>
  </node>
</launch>
```

### パッケージ統合
```cmake
# CMakeLists.txt
find_package(catkin REQUIRED COMPONENTS
  rospy
  roscpp
  your_msgs  # SvgLayerArray, SvgUpdateArray を含む
)
```

```xml
<!-- package.xml -->
<depend>your_msgs</depend>
<depend>rospy</depend>
<depend>roscpp</depend>
```

## 📊 パフォーマンス考慮事項

### メッセージサイズ最適化
- **SVG要素の簡素化**: 不要な属性の削除
- **座標の丸め**: 適切な精度での数値丸め
- **文字列圧縮**: 冗長な表現の排除

### 発行頻度の調整
```python
# 要素別の最適な更新頻度
frequencies = {
    'robots': 30,        # 30Hz - 高頻度
    'ball': 50,          # 50Hz - 最高頻度  
    'referee_signals': 5, # 5Hz - 中頻度
    'field_elements': 0.1 # 0.1Hz - 低頻度
}
```

この包括的なAPI仕様により、Crane Visualizerパネルとの効率的な統合と最適なパフォーマンスを実現できます。
