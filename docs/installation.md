# インストールと設定ガイド

## 📋 システム要件

### 必須環境
- **Node.js**: v16.0.0以上
- **npm**: v8.0.0以上
- **Foxglove Studio**: v1.62.0以上
- **OS**: Windows 10/11, macOS 10.15+, Ubuntu 18.04+

### 推奨環境
- **メモリ**: 8GB以上（大量の履歴データ処理時）
- **ストレージ**: 1GB以上の空き容量
- **ネットワーク**: ROSトピック購読用の安定したネットワーク接続

## 🚀 インストール手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/ibis-ssl/foxglove_crane_visualizer.git
cd foxglove_crane_visualizer
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. プロジェクトのビルド

```bash
npm run build
```

### 4. Foxglove Studioへのインストール

#### 方法A: ローカルインストール（開発時推奨）
```bash
npm run local-install
```

#### 方法B: パッケージファイルからのインストール
```bash
# パッケージファイルの作成
npm run foxglove:package

# 生成された.foxeファイルをFoxglove Studioにドラッグ&ドロップ
```

## ⚙️ 初期設定

### 1. Foxglove Studioでの拡張機能確認

1. Foxglove Studioを起動
2. パネル追加メニューから「Crane Visualizer Panel」を選択
3. パネルが正常に表示されることを確認

### 2. 基本設定の構成

#### トピック設定
- **スナップショットトピック**: `/aggregated_svgs`（デフォルト）
- **更新トピック**: `/visualizer_svgs`（デフォルト）
- **更新トピック有効**: `true`（推奨）

#### パフォーマンス設定
- **履歴保持期間**: `300秒`（5分、推奨）
- **最大履歴サイズ**: `1000メッセージ`（推奨）

#### 表示設定
- **背景色**: `#585858ff`（デフォルト）
- **ViewBox幅**: `10000`（フィールドサイズに応じて調整）

## 🔧 ROSトピックの準備

### 必要なROSトピック

#### 1. スナップショットトピック (`/aggregated_svgs`)
```yaml
# メッセージ型: SvgLayerArray
svg_primitive_arrays:
  - layer: "field"
    svg_primitives:
      - "<circle cx='0' cy='0' r='100' fill='blue'/>"
      - "<line x1='-4500' y1='0' x2='4500' y2='0' stroke='white'/>"
  - layer: "robots/team_blue"
    svg_primitives:
      - "<circle cx='1000' cy='500' r='90' fill='blue'/>"
```

#### 2. 更新トピック (`/visualizer_svgs`)
```yaml
# メッセージ型: SvgUpdateArray
updates:
  - layer: "robots/team_blue"
    operation: "replace"  # append, replace, clear
    svg_primitives:
      - "<circle cx='1100' cy='600' r='90' fill='blue'/>"
```

### ROS環境での設定例

#### launch ファイル例
```xml
<launch>
  <!-- スナップショット配信（低頻度） -->
  <node name="svg_snapshot_publisher" pkg="your_package" type="snapshot_node">
    <param name="topic_name" value="/aggregated_svgs"/>
    <param name="publish_rate" value="0.2"/>  <!-- 5秒間隔 -->
  </node>
  
  <!-- 更新配信（高頻度） -->
  <node name="svg_update_publisher" pkg="your_package" type="update_node">
    <param name="topic_name" value="/visualizer_svgs"/>
    <param name="publish_rate" value="30.0"/>  <!-- 30Hz -->
  </node>
</launch>
```

## 🔍 動作確認

### 1. 基本動作のテスト

1. ROSトピックが正常に配信されていることを確認
```bash
rostopic echo /aggregated_svgs -n 1
rostopic echo /visualizer_svgs -n 1
```

2. Foxglove StudioでCrane Visualizerパネルを開く

3. 設定パネルでトピック名が正しく設定されていることを確認

4. SVG要素が正常に表示されることを確認

### 2. 時間シーク機能のテスト

1. ログファイルまたはライブデータでパネルを開く
2. Foxglove Studioの時間スライダーを操作
3. 時間移動に応じて表示内容が適切に更新されることを確認

### 3. 履歴管理機能のテスト

1. パネル下部の履歴情報を確認
2. 長時間の動作で自動クリーンアップが機能することを確認
3. 設定変更によりメモリ使用量が適切に制御されることを確認

## 🛠️ トラブルシューティング

### よくある問題と解決方法

#### パネルが表示されない
- Foxglove Studioのバージョンを確認
- ブラウザのコンソールでエラーをチェック
- 拡張機能の再インストールを試行

#### トピックが受信されない
- ROSトピックの配信状況を確認
- トピック名の設定を再確認
- ネットワーク接続を確認

#### 表示が更新されない
- メッセージ形式が正しいかチェック
- 履歴サイズ制限を確認
- ブラウザのメモリ使用量をチェック

詳細なトラブルシューティングは[トラブルシューティングガイド](troubleshooting.md)を参照してください。

## 📚 次のステップ

インストールが完了したら、以下のドキュメントで詳細な機能を学習してください：

- [設定ガイド](configuration-guide.md) - 詳細な設定オプション
- [複数トピック統合機能](multi-topic-integration.md) - 効率的なデータ管理
- [時間軸対応機能](time-seeking.md) - 時間シーク機能の活用
- [レイヤー管理](layer-management.md) - SVGレイヤーの制御