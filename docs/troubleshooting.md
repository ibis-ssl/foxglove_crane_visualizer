# トラブルシューティング

## 🚨 一般的な問題と解決方法

### パネルが表示されない

#### 症状
- Foxglove Studioでパネル一覧にCrane Visualizerが表示されない
- パネルを追加しようとするとエラーが発生する

#### 原因と解決方法

**1. 拡張機能が正しくインストールされていない**
```bash
# インストール状況の確認
npm list @foxglove/extension

# 再インストールの実行
npm run clean
npm install
npm run local-install
```

**2. Foxglove Studioのバージョン不適合**
```bash
# 必要バージョンの確認
grep "@foxglove/studio" package.json

# Foxglove Studioの更新
# 公式サイトから最新版をダウンロード
```

**3. ブラウザキャッシュの問題**
```javascript
// 開発者ツールのコンソールで実行
localStorage.clear();
sessionStorage.clear();
location.reload();
```

### トピックが受信されない

#### 症状
- パネルは表示されるが、SVG要素が表示されない
- 「Receive num: 0」のまま変化しない

#### 診断手順

**1. ROSトピックの確認**
```bash
# トピック一覧の確認
rostopic list | grep svg

# メッセージの確認
rostopic echo /aggregated_svgs -n 1
rostopic echo /visualizer_svgs -n 1

# 発行レートの確認
rostopic hz /aggregated_svgs
rostopic hz /visualizer_svgs
```

**2. トピック名の設定確認**
- パネル設定でトピック名が正しく設定されているか確認
- 大文字小文字、スペース、特殊文字の確認

**3. ネットワーク接続の確認**
```bash
# ROS_MASTER_URIの確認
echo $ROS_MASTER_URI

# ROSコアの動作確認
roscore &
```

#### 解決方法

**メッセージ形式の確認**
```python
# 正しいメッセージ構造の例
msg = SvgLayerArray()
layer = SvgPrimitiveArray()
layer.layer = "test/circle"
layer.svg_primitives = ["<circle cx='0' cy='0' r='100' fill='red'/>"]
msg.svg_primitive_arrays = [layer]
```

### 時間シーク機能が動作しない

#### 症状
- Foxglove Studioの時間スライダーを動かしても表示が変わらない
- 「Seek Time」が表示されない、または更新されない

#### 原因と解決方法

**1. currentTime が利用できない**
```typescript
// 開発者ツールのコンソールで確認
console.log('renderState.currentTime available:', !!renderState.currentTime);

// ログファイルを使用していることを確認
// ライブデータではcurrentTimeが利用できない場合がある
```

**2. 履歴データが不足している**
```typescript
// 履歴状況の確認
console.log('Aggregated messages:', aggregatedMessages.size);
console.log('Update messages:', updateMessages.size);

// 履歴設定の調整
maxHistoryDuration: 1800,  // 30分に延長
maxHistorySize: 5000       // サイズ制限を拡大
```

**3. メッセージのタイムスタンプが不正**
```python
# ROSメッセージのタイムスタンプ確認
rosbag info your_log_file.bag
rostopic echo /aggregated_svgs -n 1 | grep -A 5 stamp
```

### 表示が更新されない

#### 症状
- メッセージは受信されているが、画面の表示が古いまま
- 一部のレイヤーのみ更新されない

#### 診断手順

**1. ブラウザのパフォーマンス確認**
```javascript
// 開発者ツールのPerformanceタブで
// - メモリ使用量
// - CPU使用率
// - レンダリング時間
// を確認
```

**2. レイヤー設定の確認**
```typescript
// 非表示レイヤーがないか確認
Object.entries(config.namespaces).forEach(([layer, settings]) => {
  if (!settings.visible) {
    console.log('Hidden layer:', layer);
  }
});
```

#### 解決方法

**メモリ不足の場合**
```json
{
  "maxHistoryDuration": 60,    // 1分間に短縮
  "maxHistorySize": 200       // サイズを削減
}
```

**SVG要素の最適化**
```xml
<!-- 重すぎるSVG要素を簡素化 -->
<!-- 悪い例 -->
<path d="M0,0 L1,1 L2,2 L3,3 ... (膨大な座標)" stroke="red"/>

<!-- 良い例 -->
<circle cx="100" cy="100" r="50" fill="red"/>
```

### レイヤー操作が機能しない

#### 症状
- append/replace/clear操作が期待通りに動作しない
- 更新トピックのメッセージが無視される

#### 原因と解決方法

**1. 操作名の間違い**
```python
# 正しい操作名を使用
valid_operations = ["append", "replace", "clear"]

# 間違いやすい例
update.operation = "add"      # ❌ "append"が正しい
update.operation = "delete"   # ❌ "clear"が正しい
update.operation = "update"   # ❌ "replace"が正しい
```

**2. レイヤー名の不一致**
```python
# スナップショットとupdate で同じレイヤー名を使用
snapshot_layer = "robots/team_blue/robot_0"
update_layer = "robots/team_blue/robot_0"  # 完全一致が必要
```

**3. 更新トピックが無効化されている**
```typescript
// 設定を確認
if (!config.enableUpdateTopic) {
  console.log('Update topic is disabled');
}
```

## 🔍 デバッグツール

### ブラウザ開発者ツールの活用

#### コンソールでの状態確認
```javascript
// パネルの内部状態を確認
console.log('Config:', config);
console.log('Messages received:', recv_num);
console.log('Latest message:', latest_msg);
console.log('Seek time:', seekTime);
```

#### ネットワークタブでの通信確認
- WebSocket接続の状態
- メッセージの送受信頻度
- エラーレスポンスの確認

#### パフォーマンスタブでの性能分析
- レンダリング時間の測定
- メモリ使用量の監視
- CPU使用率の確認

### ログ出力の活用

#### 開発モードでの詳細ログ
```typescript
// 環境変数による詳細ログ有効化
if (process.env.NODE_ENV === 'development') {
  console.log('Detailed debug info:', {
    targetTime,
    baseSnapshotTime,
    relevantUpdatesCount: relevantUpdates.length
  });
}
```

#### カスタムログ追加
```typescript
// 問題箇所での詳細ログ出力
console.group('Message Composition Debug');
console.log('Target time:', new Date(targetTime));
console.log('Base snapshot found:', !!latestAggregatedMsg);
console.log('Updates to apply:', relevantUpdates.length);
console.groupEnd();
```

## 🛠️ 高度なトラブルシューティング

### メモリリークの対策

#### 履歴のクリーンアップ確認
```typescript
// クリーンアップの動作確認
const cleanupHistory = () => {
  const before = {
    aggregated: aggregatedMessages.size,
    updates: updateMessages.size
  };
  
  // クリーンアップ実行
  performCleanup();
  
  const after = {
    aggregated: aggregatedMessages.size,
    updates: updateMessages.size
  };
  
  console.log('Cleanup result:', { before, after });
};
```

#### メモリ使用量の監視
```javascript
// ブラウザでのメモリ監視
if ('memory' in performance) {
  setInterval(() => {
    const memory = performance.memory;
    console.log('Memory usage:', {
      used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
      total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
      limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB'
    });
  }, 5000);
}
```

### パフォーマンス最適化

#### SVG要素数の制限
```typescript
// 大量のSVG要素を制限
const MAX_SVG_ELEMENTS_PER_LAYER = 1000;

const optimizeLayer = (primitives: string[]) => {
  if (primitives.length > MAX_SVG_ELEMENTS_PER_LAYER) {
    console.warn(`Layer has ${primitives.length} elements, truncating to ${MAX_SVG_ELEMENTS_PER_LAYER}`);
    return primitives.slice(-MAX_SVG_ELEMENTS_PER_LAYER);
  }
  return primitives;
};
```

#### 更新頻度の調整
```python
# ROSノード側での頻度制限
class AdaptivePublisher:
    def __init__(self):
        self.last_publish_time = 0
        self.min_interval = 1.0 / 30  # 最大30Hz
    
    def publish_if_needed(self, data):
        current_time = time.time()
        if current_time - self.last_publish_time >= self.min_interval:
            self.publisher.publish(data)
            self.last_publish_time = current_time
```

## 📞 サポート情報

### ログ情報の収集

問題報告時には以下の情報を収集してください：

#### 1. 環境情報
```bash
# Node.js/npm バージョン
node --version
npm --version

# Foxglove Studio バージョン
# ヘルプ -> About で確認

# OS情報
uname -a  # Linux/macOS
systeminfo  # Windows
```

#### 2. 設定情報
```json
// パネル設定をエクスポート
{
  "current_config": "設定パネルから現在の設定をコピー",
  "layout_file": "Foxglove Studioのレイアウトファイル"
}
```

#### 3. エラーログ
```javascript
// ブラウザコンソールのエラーメッセージ
// Networkタブのエラー応答
// Foxglove Studio のログファイル
```

### コミュニティサポート

- **GitHub Issues**: [プロジェクトリポジトリ](https://github.com/ibis-ssl/foxglove_crane_visualizer/issues)
- **RoboCup SSL コミュニティ**: 関連フォーラムでの質問
- **Foxglove Studio**: [公式サポート](https://foxglove.dev/docs)

### 緊急時の回避策

#### 最小構成での動作確認
```json
{
  "aggregatedTopic": "/test_topic",
  "updateTopic": "/unused", 
  "enableUpdateTopic": false,
  "maxHistoryDuration": 60,
  "maxHistorySize": 100
}
```

#### レガシーモードでの動作
```python
# 単純なスナップショットのみでテスト
def publish_simple_test():
    msg = SvgLayerArray()
    layer = SvgPrimitiveArray() 
    layer.layer = "test"
    layer.svg_primitives = ["<circle cx='0' cy='0' r='100' fill='red'/>"]
    msg.svg_primitive_arrays = [layer]
    pub.publish(msg)
```

この包括的なトラブルシューティングガイドにより、Crane Visualizerパネルの問題を迅速に特定・解決できます。