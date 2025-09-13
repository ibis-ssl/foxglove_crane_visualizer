# 設定ガイド

## 🎛️ 設定パネル概要

Crane Visualizerパネルの設定は、論理的にグループ化された4つのセクションに分かれています。各セクションは特定の機能領域を管理し、効率的な設定変更を可能にします。

## 📡 トピック設定

### スナップショットトピック
- **設定項目**: `aggregatedTopic`
- **デフォルト値**: `/aggregated_svgs`
- **説明**: 完全な状態情報を含む低頻度トピック
- **推奨値**: プロジェクトのROSトピック命名規則に従って設定

```yaml
# 例: チーム別設定
aggregatedTopic: "/team_blue/aggregated_svgs"
aggregatedTopic: "/simulation/field_state"
aggregatedTopic: "/match_recorder/full_state"
```

### 更新トピック
- **設定項目**: `updateTopic`
- **デフォルト値**: `/visualizer_svgs`
- **説明**: レイヤーごとの増分更新を含む高頻度トピック
- **推奨値**: スナップショットトピックと整合性を保つ命名

```yaml
# 例: 対応する更新トピック
updateTopic: "/team_blue/svg_updates"
updateTopic: "/simulation/dynamic_updates"
updateTopic: "/match_recorder/incremental_updates"
```

### 更新トピック有効化
- **設定項目**: `enableUpdateTopic`
- **デフォルト値**: `true`
- **説明**: 更新トピックの使用可否を制御

#### 有効時 (`true`) - 推奨設定
- スナップショット + 更新の統合処理
- 最大90%のログサイズ削減
- 高精度なリアルタイム更新

#### 無効時 (`false`) - レガシー互換
- スナップショットトピックのみ使用
- 従来のFoxglove拡張と同等の動作
- シンプルな設定でのテスト用途

## ⚡ パフォーマンス設定

### 履歴保持期間
- **設定項目**: `maxHistoryDuration`
- **デフォルト値**: `300秒`（5分間）
- **単位**: 秒
- **説明**: メモリに保持するメッセージの最大期間

#### 用途別推奨値
```json
{
  "リアルタイム分析": 60,     // 1分間
  "短期戦術分析": 300,       // 5分間  
  "試合全体レビュー": 1800,   // 30分間
  "長期間データ分析": 7200    // 2時間
}
```

#### メモリ使用量の目安
```
60秒設定:   約50MB
300秒設定:  約250MB
1800秒設定: 約1.5GB
7200秒設定: 約6GB
```

### 最大履歴サイズ
- **設定項目**: `maxHistorySize`
- **デフォルト値**: `1000メッセージ`
- **説明**: 保持するメッセージの最大数（期間制限の補完）

#### 設定の考え方
```typescript
// 実際の制限 = min(maxHistoryDuration, maxHistorySize)
// 例: 30Hzの更新トピックの場合
const messagesIn5Minutes = 30 * 60 * 5; // 9000メッセージ
// maxHistorySize: 1000 → 実際は約33秒分のみ保持
```

#### 推奨設定値
```json
{
  "低メモリ環境": 500,
  "標準環境": 1000,
  "高性能環境": 5000,
  "サーバー環境": 10000
}
```

## 🎨 表示設定

### 背景色
- **設定項目**: `backgroundColor`
- **デフォルト値**: `#585858ff`
- **形式**: RGBA色指定
- **説明**: SVGキャンバスの背景色

#### 色指定の詳細
```css
/* 16進数RGBA表記 */
#585858ff /* グレー、不透明 */
#000000ff /* 黒、不透明 */
#ffffffcc /* 白、半透明 */
#00ff0080 /* 緑、50%透明 */
```

#### 用途別推奨色
```json
{
  "フィールド表示": "#228b22ff",    // フォレストグリーン
  "技術分析": "#000000ff",         // 黒
  "プレゼンテーション": "#ffffffff", // 白
  "デバッグ": "#404040ff"          // ダークグレー
}
```

### ViewBox幅
- **設定項目**: `viewBoxWidth`
- **デフォルト値**: `10000`
- **単位**: 座標単位（通常はmm）
- **説明**: 表示範囲の幅（ズームレベルに影響）

#### SSL標準フィールドサイズ対応
```json
{
  "フィールド全体": 12000,    // 12m幅
  "ハーフフィールド": 6000,   // 6m幅  
  "ペナルティエリア": 2400,   // 2.4m幅
  "詳細分析": 1000           // 1m幅
}
```

#### アスペクト比の自動調整
```typescript
// 高さは幅の60%で自動計算
const height = viewBoxWidth * 0.6;
const viewBox = `${-viewBoxWidth/2} ${-height/2} ${viewBoxWidth} ${height}`;
```

## 📁 名前空間（レイヤー表示制御）

### 階層構造の管理
レイヤーは階層的な名前空間で管理され、個別に表示/非表示を制御できます。

```
field/                    ✓ 表示
├─ boundary              ✓ 表示
├─ goals                 ✓ 表示
└─ center_circle         ✗ 非表示

robots/                   ✓ 表示
├─ team_blue/            ✓ 表示
│  ├─ robot_0           ✓ 表示
│  └─ robot_1           ✗ 非表示
└─ team_yellow/          ✗ 非表示

debug/                    ✗ 非表示
├─ trajectories          - 親が非表示
└─ ai_decisions          - 親が非表示
```

### 動的レイヤー発見
新しいレイヤーが含まれるメッセージを受信すると、自動的に設定項目に追加されます。

```typescript
// 新レイヤーの自動追加
msg.svg_primitive_arrays.forEach((svg_primitive_array) => {
  if (!config.namespaces[svg_primitive_array.layer]) {
    // デフォルトで表示状態で追加
    newNamespaces[svg_primitive_array.layer] = { visible: true };
  }
});
```

## 🔧 設定ファイルの管理

### 設定の永続化
Foxglove Studioがパネル設定を自動的に保存・復元します。

```json
// 保存される設定例
{
  "backgroundColor": "#585858ff",
  "viewBoxWidth": 10000,
  "aggregatedTopic": "/aggregated_svgs",
  "updateTopic": "/visualizer_svgs", 
  "enableUpdateTopic": true,
  "maxHistoryDuration": 300,
  "maxHistorySize": 1000,
  "namespaces": {
    "field/boundary": { "visible": true },
    "robots/team_blue/robot_0": { "visible": true },
    "debug/trajectories": { "visible": false }
  }
}
```

### 設定のエクスポート・インポート
Foxglove Studioのレイアウト機能を使用して設定を保存・共有できます。

## 📊 設定監視とデバッグ

### リアルタイム情報表示
パネル下部に設定の動作状況が表示されます。

```
Aggregated Topic: /aggregated_svgs
Update Topic: /visualizer_svgs
Receive num: 1250
History: Aggregated(25), Updates(750)
Seek Time: 2024-01-15T10:30:45.123Z
```

### パフォーマンス指標
- **Receive num**: 受信メッセージ総数
- **History counts**: 各トピックの履歴保持数
- **Seek Time**: 現在の時間シーク位置

## 🚀 高度な設定パターン

### 開発環境設定
```json
{
  "aggregatedTopic": "/dev/aggregated_svgs",
  "updateTopic": "/dev/svg_updates",
  "enableUpdateTopic": true,
  "maxHistoryDuration": 60,
  "maxHistorySize": 500,
  "backgroundColor": "#404040ff",
  "viewBoxWidth": 8000
}
```

### 本番環境設定
```json
{
  "aggregatedTopic": "/match/field_state",
  "updateTopic": "/match/updates",
  "enableUpdateTopic": true,
  "maxHistoryDuration": 1800,
  "maxHistorySize": 5000,
  "backgroundColor": "#228b22ff",
  "viewBoxWidth": 12000
}
```

### デモ・プレゼンテーション設定
```json
{
  "aggregatedTopic": "/demo/visualization",
  "updateTopic": "/demo/highlights",
  "enableUpdateTopic": true,
  "maxHistoryDuration": 300,
  "maxHistorySize": 1000,
  "backgroundColor": "#ffffffff",
  "viewBoxWidth": 10000
}
```

## 💡 設定のベストプラクティス

### 1. 段階的な設定変更
大きな変更は段階的に行い、各ステップで動作確認を実施

### 2. 環境別設定管理
開発・テスト・本番で異なる設定プロファイルを維持

### 3. パフォーマンス監視
メモリ使用量と応答性能を定期的にチェック

### 4. バックアップ
重要な設定はFoxglove Studioのレイアウト機能で保存

### 5. チーム共有
チーム内で標準的な設定を共有し、一貫した分析環境を構築

この包括的な設定ガイドにより、様々な用途と環境に応じたCrane Visualizerパネルの最適化を実現できます。