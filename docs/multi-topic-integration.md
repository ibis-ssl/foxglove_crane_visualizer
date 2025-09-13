# 複数トピック統合機能

## 🎯 概要

複数トピック統合機能は、Crane Visualizerパネルの核心的な革新機能です。従来の単一トピック方式では、全ての可視化データを毎フレーム送信する必要があり、ログファイルサイズの肥大化が深刻な問題でした。この機能により、**最大90%のログサイズ削減**を実現しています。

## 🔄 2つのトピック方式

### スナップショットトピック (`/aggregated_svgs`)
- **目的**: 完全な状態情報を定期的に配信
- **頻度**: 低頻度（推奨：5秒間隔）
- **内容**: 全レイヤーの完全なSVGデータ
- **役割**: 時間シーク時の基準点、初期状態の確立

### 更新トピック (`/visualizer_svgs`)
- **目的**: レイヤー単位の増分更新を配信
- **頻度**: 高頻度（推奨：30Hz）
- **内容**: 変更されたレイヤーのみの差分データ
- **役割**: リアルタイム更新、動的要素の追跡

## 📊 データ効率化の仕組み

### 従来方式の問題
```
時刻0秒: [フィールド, ロボット1, ロボット2, ボール, 軌跡] - 100KB
時刻1秒: [フィールド, ロボット1, ロボット2, ボール, 軌跡] - 100KB
時刻2秒: [フィールド, ロボット1, ロボット2, ボール, 軌跡] - 100KB
...
合計: 100KB × 600秒 = 60MB
```

### 新方式の効率化
```
時刻0秒: [スナップショット: 全レイヤー] - 100KB
時刻1秒: [更新: ロボット1のみ] - 2KB
時刻2秒: [更新: ボール位置のみ] - 1KB
時刻3秒: [更新: 軌跡追加] - 3KB
時刻4秒: [更新: ロボット2のみ] - 2KB
時刻5秒: [スナップショット: 全レイヤー] - 100KB
...
合計: 約6MB（90%削減）
```

## 🏗️ 技術実装

### メッセージ構造

#### SvgLayerArray（スナップショット用）
```typescript
interface SvgLayerArray {
  svg_primitive_arrays: SvgPrimitiveArray[];
}

interface SvgPrimitiveArray {
  layer: string; // "field/center_circle"
  svg_primitives: string[];
}
```

#### SvgUpdateArray（更新用）
```typescript
interface SvgUpdateArray {
  updates: SvgLayerUpdate[];
}

interface SvgLayerUpdate {
  layer: string; // "robots/team_blue/robot_0"
  operation: "append" | "replace" | "clear";
  svg_primitives: string[];
}
```

### レイヤー操作の詳細

#### append操作
```typescript
// 既存のSVG要素に新要素を追加
// 用途: 軌跡の延長、新しいマーカーの追加
{
  layer: "trajectories/robot_0",
  operation: "append",
  svg_primitives: ["<circle cx='100' cy='200' r='5' fill='red'/>"]
}
```

#### replace操作
```typescript
// レイヤー全体を新しい内容で置換
// 用途: ロボット位置の更新、状態変更
{
  layer: "robots/team_blue/robot_0",
  operation: "replace",
  svg_primitives: ["<circle cx='1500' cy='800' r='90' fill='blue'/>"]
}
```

#### clear操作
```typescript
// レイヤーの全要素を削除
// 用途: 古い軌跡の消去、一時的要素の削除
{
  layer: "debug/temporary_markers",
  operation: "clear",
  svg_primitives: []
}
```

## ⏰ 時間軸統合処理

### メッセージ合成アルゴリズム

1. **基準スナップショット検索**
   ```typescript
   // 指定時刻以前の最新スナップショットを検索
   const baseSnapshot = findLatestSnapshotBefore(targetTime);
   ```

2. **関連更新の抽出**
   ```typescript
   // スナップショット以降、指定時刻までの更新を時系列順に取得
   const updates = getUpdatesInTimeRange(baseSnapshot.time, targetTime);
   ```

3. **レイヤー状態の構築**
   ```typescript
   // ベースレイヤーから開始して更新を順次適用
   let layerState = cloneSnapshot(baseSnapshot);
   for (const update of updates) {
     applyLayerUpdate(layerState, update);
   }
   ```

### 実装例

```typescript
const composeMessagesAtTime = (targetTime: number): SvgLayerArray | undefined => {
  // 1. 基準スナップショットを検索
  let latestSnapshot: SvgLayerArray | undefined;
  let snapshotTime = -1;
  
  for (const [timestamp, message] of aggregatedMessages) {
    if (timestamp <= targetTime && timestamp > snapshotTime) {
      snapshotTime = timestamp;
      latestSnapshot = message.message as SvgLayerArray;
    }
  }
  
  if (!latestSnapshot) return undefined;
  
  // 2. レイヤーマップを初期化
  const layerMap = new Map<string, string[]>();
  latestSnapshot.svg_primitive_arrays.forEach(array => {
    layerMap.set(array.layer, [...array.svg_primitives]);
  });
  
  // 3. 更新を時系列順に適用
  const relevantUpdates = getUpdatesInRange(snapshotTime, targetTime);
  
  for (const [_, updateArray] of relevantUpdates) {
    for (const update of updateArray.updates) {
      const currentPrimitives = layerMap.get(update.layer) || [];
      
      switch (update.operation) {
        case "replace":
          layerMap.set(update.layer, [...update.svg_primitives]);
          break;
        case "append":
          layerMap.set(update.layer, [...currentPrimitives, ...update.svg_primitives]);
          break;
        case "clear":
          layerMap.set(update.layer, []);
          break;
      }
    }
  }
  
  // 4. 結果をSvgLayerArray形式に変換
  return {
    svg_primitive_arrays: Array.from(layerMap.entries()).map(([layer, primitives]) => ({
      layer,
      svg_primitives: primitives
    }))
  };
};
```

### フォールバック戦略（スナップショット不在時）
スナップショットが履歴に存在しない時刻へのシークでは、更新トピックのみから仮状態を合成します。

- 適用方針: `replace` と `clear` を時系列に適用、`append` は無視
- 前提: `replace` はそのレイヤーの完全表現を含む（自己完結）
- 目的: 長距離の巻き戻しやキー フレーム欠損時でも視覚破綻を避ける

```typescript
// aggregated が無い場合の簡易合成
const updates = getUpdatesInTimeRange(-Infinity, targetTime); // 昇順
const layerMap = new Map<string, string[]>();
for (const updateArray of updates) {
  for (const u of updateArray.updates) {
    switch (u.operation) {
      case 'replace': layerMap.set(u.layer, [...u.svg_primitives]); break;
      case 'clear':   layerMap.set(u.layer, []); break;
      case 'append':  /* ベース不在では無視 */ break;
    }
  }
}
return buildFinalState(layerMap); // 空なら undefined
```

## 📈 パフォーマンス最適化

### メモリ管理戦略

#### 履歴サイズ制限
```typescript
// 設定可能な制限値
maxHistoryDuration: 300, // 5分間
maxHistorySize: 1000,    // 最大1000メッセージ
```

#### 自動クリーンアップ
```typescript
// 30秒ごとに古いメッセージを削除
setInterval(() => {
  cleanupOldMessages();
}, 30000);
```

### 処理効率化

#### タイムスタンプベース検索
```typescript
// Map構造による高速タイムスタンプ検索
const messageMap = new Map<number, MessageEvent>();
const timestamp = message.receiveTime.sec * 1000 + message.receiveTime.nsec / 1000000;
messageMap.set(timestamp, message);
```

#### レイヤーマップの最適化
```typescript
// 空のレイヤーを除外して処理量を削減
const result = Array.from(layerMap.entries())
  .filter(([_, primitives]) => primitives.length > 0)
  .map(([layer, primitives]) => ({ layer, svg_primitives: primitives }));
```

## 🔧 設定とカスタマイズ

### 推奨設定値

#### 低遅延環境（リアルタイム分析）
```json
{
  "aggregatedTopic": "/aggregated_svgs",
  "updateTopic": "/visualizer_svgs",
  "enableUpdateTopic": true,
  "maxHistoryDuration": 60,  // 1分間
  "maxHistorySize": 500
}
```

#### 長時間分析環境（試合レビュー）
```json
{
  "aggregatedTopic": "/aggregated_svgs",
  "updateTopic": "/visualizer_svgs", 
  "enableUpdateTopic": true,
  "maxHistoryDuration": 1800, // 30分間
  "maxHistorySize": 5000
}
```

#### レガシー互換モード
```json
{
  "aggregatedTopic": "/aggregated_svgs",
  "updateTopic": "/visualizer_svgs",
  "enableUpdateTopic": false  // 更新トピック無効
}
```

## 💡 活用のベストプラクティス

### ROSノード側の実装推奨事項

#### スナップショット配信
- **頻度**: 3-10秒間隔（データ量と精度のバランス）
- **内容**: 全レイヤーの完全状態
- **タイミング**: 定期的または状態変化時

#### 更新配信
- **頻度**: 10-50Hz（要求精度に応じて）
- **内容**: 変更されたレイヤーのみ
- **最適化**: 連続する同一レイヤー更新の統合

#### レイヤー設計
```
field/              # 静的要素（低頻度更新）
├─ boundary
├─ goals
└─ center_circle

robots/             # 動的要素（高頻度更新）
├─ team_blue/
│  ├─ robot_0
│  └─ robot_1
└─ team_yellow/

game_state/         # 状態表示（中頻度更新）
├─ score
├─ time
└─ referee_signals

debug/              # デバッグ情報（必要時のみ）
├─ trajectories
├─ target_positions
└─ ai_decisions
```

この複数トピック統合機能により、大幅なログサイズ削減と高精度な時間シーク機能を両立し、効率的なロボットサッカー分析環境を実現しています。
