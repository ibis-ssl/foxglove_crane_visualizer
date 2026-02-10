import * as React from "react";
import { useCallback, useLayoutEffect, useRef, useState, useEffect, useMemo } from "react";
import {
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeField,
  MessageEvent,
  Topic,
  Subscription,
  Immutable
} from "@foxglove/studio";
import ReactDOM from "react-dom";
import { StrictMode } from "react";

interface SvgPrimitiveArray {
  layer: string; // "parent/child1/child2"のような階層パス
  svg_primitives: string[];
}

interface SvgLayerArray {
  svg_primitive_arrays: SvgPrimitiveArray[];
}

// 互換性用: 新しいスナップショット形式（SvgSnapshot）の可能性
interface SvgSnapshotCompat {
  layers?: SvgPrimitiveArray[];
}

// /visualizer_svgsトピック用のインターフェース
interface SvgLayerUpdate {
  layer: string; // "parent/child1/child2"のような階層パス
  operation: "append" | "replace" | "clear"; // 操作タイプ
  svg_primitives: string[]; // SVGプリミティブ配列
  duration?: number; // 有効期限(秒)。0または未定義=無限
}

interface SvgUpdateArray {
  updates: SvgLayerUpdate[];
}

// レフェリーメッセージ関連インターフェース
interface RefereeTeamInfo {
  name: string;
  score: number;
  red_cards: number;
  yellow_cards: number;
  yellow_card_times: number[];
  timeouts: number;
  timeout_time: number;
  goalkeeper: number;
  foul_counter: number;
  max_allowed_bots: number;
}

interface RefereeMessage {
  stage: { value: number };
  command: { value: number };
  stage_time_left: number;
  yellow: RefereeTeamInfo;
  blue: RefereeTeamInfo;
}

// ステージ短縮名マップ
const STAGE_SHORT_NAMES: Record<number, string> = {
  0: "NORMAL 1ST HALF",
  1: "NORMAL 1ST HALF",
  2: "NORMAL HALF TIME",
  3: "NORMAL 2ND HALF",
  4: "NORMAL 2ND HALF",
  5: "BREAK",
  6: "OT 1ST HALF",
  7: "OT 1ST HALF",
  8: "OT HALF TIME",
  9: "OT 2ND HALF",
  10: "OT 2ND HALF",
  11: "BREAK",
  12: "PENALTY",
  13: "PENALTY",
  14: "POST GAME",
};

// コマンド表示名マップ
const COMMAND_NAMES: Record<number, string> = {
  0: "HALT",
  1: "STOP",
  2: "NORMAL START",
  3: "FORCE START",
  4: "PREPARE KICKOFF YELLOW",
  5: "PREPARE KICKOFF BLUE",
  6: "PREPARE PENALTY YELLOW",
  7: "PREPARE PENALTY BLUE",
  8: "DIRECT FREE YELLOW",
  9: "DIRECT FREE BLUE",
  12: "TIMEOUT YELLOW",
  13: "TIMEOUT BLUE",
  16: "BALL PLACEMENT YELLOW",
  17: "BALL PLACEMENT BLUE",
};

// コマンドカテゴリマップ
const COMMAND_CATEGORIES: Record<number, string> = {
  0: "halt",
  1: "stop",
  2: "running",
  3: "running",
  4: "yellow_action",
  5: "blue_action",
  6: "yellow_action",
  7: "blue_action",
  8: "yellow_action",
  9: "blue_action",
  12: "yellow_action",
  13: "blue_action",
  16: "yellow_action",
  17: "blue_action",
};

// スコアボードカラーパレット
const SCOREBOARD_COLORS = {
  bg: "rgba(10, 10, 20, 0.85)",
  border: "rgba(255, 255, 255, 0.1)",
  text: "#FFFFFF",
  textDim: "rgba(255, 255, 255, 0.6)",
  yellow: "#FFD700",
  yellowBg: "rgba(255, 215, 0, 0.15)",
  blue: "#4D9FFF",
  blueBg: "rgba(77, 159, 255, 0.15)",
  halt: "#FF4444",
  stop: "#FF8C00",
  running: "#44FF44",
  timerWarning: "#FF6B6B",
  timerNegative: "#FF4444",
} as const;

// カテゴリ色マップ
const CATEGORY_COLORS: Record<string, string> = {
  halt: SCOREBOARD_COLORS.halt,
  stop: SCOREBOARD_COLORS.stop,
  running: SCOREBOARD_COLORS.running,
  yellow_action: SCOREBOARD_COLORS.yellow,
  blue_action: SCOREBOARD_COLORS.blue,
};

// マイクロ秒 → "MM:SS" 形式
const formatStageTime = (microseconds: number): string => {
  const negative = microseconds < 0;
  const totalSeconds = Math.abs(Math.floor(microseconds / 1_000_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
};

// HEXカラー → RGB値文字列
const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "255, 255, 255";
  return `${parseInt(result[1]!, 16)}, ${parseInt(result[2]!, 16)}, ${parseInt(result[3]!, 16)}`;
};

// 正規化ヘルパ（スナップショット）
const normalizeSnapshot = (raw: any): SvgLayerArray | undefined => {
  try {
    const arrays: SvgPrimitiveArray[] | undefined = Array.isArray(raw?.svg_primitive_arrays)
      ? (raw.svg_primitive_arrays as SvgPrimitiveArray[])
      : Array.isArray((raw as SvgSnapshotCompat)?.layers)
      ? ((raw as SvgSnapshotCompat).layers as SvgPrimitiveArray[])
      : undefined;
    if (!arrays) return undefined;
    const filtered = arrays
      .filter((a) => a && a.layer && Array.isArray(a.svg_primitives))
      .map((a) => ({ layer: a.layer, svg_primitives: a.svg_primitives }));
    return { svg_primitive_arrays: filtered };
  } catch {
    return undefined;
  }
};

// 正規化ヘルパ（更新: 旧互換としてスナップショット形をreplaceに変換）
const normalizeUpdates = (raw: any): SvgUpdateArray | undefined => {
  try {
    if (raw && Array.isArray(raw.updates)) {
      return raw as SvgUpdateArray;
    }
    const arrays: SvgPrimitiveArray[] | undefined = Array.isArray(raw?.svg_primitive_arrays)
      ? (raw.svg_primitive_arrays as SvgPrimitiveArray[])
      : Array.isArray((raw as SvgSnapshotCompat)?.layers)
      ? ((raw as SvgSnapshotCompat).layers as SvgPrimitiveArray[])
      : undefined;
    if (!arrays) return undefined;
    return {
      updates: arrays
        .filter((a) => a && a.layer && Array.isArray(a.svg_primitives))
        .map((a) => ({ layer: a.layer, operation: "replace", svg_primitives: a.svg_primitives })),
    };
  } catch {
    return undefined;
  }
};

interface PanelConfig {
  backgroundColor: string;
  message: string;
  viewBoxWidth: number;
  aggregatedTopic: string; // /aggregated_svgsトピック名
  updateTopic: string; // /visualizer_svgsトピック名
  enableUpdateTopic: boolean; // /visualizer_svgsトピックの有効/無効
  maxHistoryDuration: number; // 履歴保持期間（秒）
  maxHistorySize: number; // 最大履歴サイズ
  refereeTopic: string; // レフェリートピック名
  enableScoreboard: boolean; // スコアボード表示の有効/無効
  namespaces: {
    [key: string]: {
      visible: boolean;
      children?: { [key: string]: { visible: boolean; children?: any } };
    };
  };
}

const defaultConfig: PanelConfig = {
  backgroundColor: "#585858ff",
  message: "",
  viewBoxWidth: 10000,
  aggregatedTopic: "/aggregated_svgs",
  updateTopic: "/visualizer_svgs",
  enableUpdateTopic: true,
  maxHistoryDuration: 300, // 5分間
  maxHistorySize: 1000, // 最大1000メッセージ
  refereeTopic: "/referee",
  enableScoreboard: true,
  namespaces: {},
};

// スコアボードオーバーレイコンポーネント
const ScoreboardOverlay: React.FC<{ refereeData: RefereeMessage }> = ({ refereeData }) => {
  const stage = refereeData.stage?.value ?? 0;
  const command = refereeData.command?.value ?? 1;
  const stageTimeLeft = refereeData.stage_time_left ?? 0;
  const yellow = refereeData.yellow;
  const blue = refereeData.blue;

  const stageName = STAGE_SHORT_NAMES[stage] ?? "UNKNOWN";
  const commandName = COMMAND_NAMES[command] ?? "UNKNOWN";
  const commandCategory = COMMAND_CATEGORIES[command] ?? "stop";
  const categoryColor = CATEGORY_COLORS[commandCategory] ?? SCOREBOARD_COLORS.stop;

  const timeStr = formatStageTime(stageTimeLeft);
  const totalSeconds = Math.floor(Math.abs(stageTimeLeft) / 1_000_000);
  const isTimeWarning = stageTimeLeft > 0 && totalSeconds < 60;
  const isTimeNegative = stageTimeLeft < 0;

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    bottom: 12,
    left: "50%",
    transform: "translateX(-50%)",
    pointerEvents: "none",
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    fontFamily: "'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
  };

  const stageBadgeStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 1.5,
    textTransform: "uppercase" as const,
    color: SCOREBOARD_COLORS.textDim,
    background: "rgba(255,255,255,0.08)",
    padding: "3px 14px",
    borderRadius: 10,
  };

  const mainBoardStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    background: SCOREBOARD_COLORS.bg,
    border: `1px solid ${SCOREBOARD_COLORS.border}`,
    borderRadius: 10,
    boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)",
    overflow: "hidden",
    minWidth: 380,
  };

  const teamSectionStyle = (teamColor: string, teamBg: string): React.CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 18px",
    background: teamBg,
    borderLeft: `3px solid ${teamColor}`,
    borderRight: `3px solid ${teamColor}`,
    minWidth: 110,
  });

  const teamNameStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    color: SCOREBOARD_COLORS.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 120,
  };

  const badgeRowStyle: React.CSSProperties = {
    display: "flex",
    gap: 4,
    marginTop: 4,
    alignItems: "center",
  };

  const cardBadgeStyle = (color: string): React.CSSProperties => ({
    width: 11,
    height: 15,
    borderRadius: 2,
    backgroundColor: color,
    border: "1px solid rgba(0,0,0,0.3)",
  });

  const cardCountStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: SCOREBOARD_COLORS.textDim,
    marginLeft: -1,
  };

  const centerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 20px",
    minWidth: 100,
  };

  const scoreStyle: React.CSSProperties = {
    fontSize: 40,
    fontWeight: 800,
    color: SCOREBOARD_COLORS.text,
    lineHeight: 1,
    letterSpacing: 3,
  };

  const timerStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    color: isTimeNegative
      ? SCOREBOARD_COLORS.timerNegative
      : isTimeWarning
        ? SCOREBOARD_COLORS.timerWarning
        : SCOREBOARD_COLORS.textDim,
    marginTop: 4,
  };

  const commandBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 14px",
    background: "rgba(10, 10, 20, 0.7)",
    borderRadius: 10,
    border: `1px solid ${categoryColor}40`,
  };

  const commandDotStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: "50%",
    backgroundColor: categoryColor,
    boxShadow: `0 0 6px ${categoryColor}, 0 0 12px ${categoryColor}80`,
  };

  const commandTextStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1,
    color: categoryColor,
  };

  const timeoutBadgeStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: SCOREBOARD_COLORS.textDim,
    background: "rgba(255,255,255,0.06)",
    padding: "2px 5px",
    borderRadius: 3,
  };

  const renderCards = (yellowCards: number, redCards: number) => (
    <div style={badgeRowStyle}>
      {yellowCards > 0 && (
        <>
          <div style={cardBadgeStyle("#FFD700")} />
          {yellowCards > 1 && <span style={cardCountStyle}>{yellowCards}</span>}
        </>
      )}
      {redCards > 0 && (
        <>
          <div style={cardBadgeStyle("#FF4444")} />
          {redCards > 1 && <span style={cardCountStyle}>{redCards}</span>}
        </>
      )}
      {yellow && (
        <span style={timeoutBadgeStyle}>TO:{yellow.timeouts ?? 0}</span>
      )}
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={stageBadgeStyle}>{stageName}</div>
      <div style={mainBoardStyle}>
        <div style={teamSectionStyle(SCOREBOARD_COLORS.yellow, SCOREBOARD_COLORS.yellowBg)}>
          <div style={{ ...teamNameStyle, textShadow: `0 0 8px ${SCOREBOARD_COLORS.yellow}60` }}>
            {yellow?.name ?? "YELLOW"}
          </div>
          {renderCards(yellow?.yellow_cards ?? 0, yellow?.red_cards ?? 0)}
        </div>
        <div style={centerStyle}>
          <div style={scoreStyle}>
            <span style={{ textShadow: `0 0 12px ${SCOREBOARD_COLORS.yellow}80` }}>
              {yellow?.score ?? 0}
            </span>
            <span style={{ color: SCOREBOARD_COLORS.textDim, margin: "0 6px", fontSize: 28 }}>:</span>
            <span style={{ textShadow: `0 0 12px ${SCOREBOARD_COLORS.blue}80` }}>
              {blue?.score ?? 0}
            </span>
          </div>
          <div style={timerStyle}>{timeStr}</div>
        </div>
        <div style={teamSectionStyle(SCOREBOARD_COLORS.blue, SCOREBOARD_COLORS.blueBg)}>
          <div style={{ ...teamNameStyle, textShadow: `0 0 8px ${SCOREBOARD_COLORS.blue}60` }}>
            {blue?.name ?? "BLUE"}
          </div>
          <div style={badgeRowStyle}>
            {(blue?.yellow_cards ?? 0) > 0 && (
              <>
                <div style={cardBadgeStyle("#FFD700")} />
                {(blue?.yellow_cards ?? 0) > 1 && <span style={cardCountStyle}>{blue?.yellow_cards}</span>}
              </>
            )}
            {(blue?.red_cards ?? 0) > 0 && (
              <>
                <div style={cardBadgeStyle("#FF4444")} />
                {(blue?.red_cards ?? 0) > 1 && <span style={cardCountStyle}>{blue?.red_cards}</span>}
              </>
            )}
            <span style={timeoutBadgeStyle}>TO:{blue?.timeouts ?? 0}</span>
          </div>
        </div>
      </div>
      <div style={commandBarStyle}>
        <div style={commandDotStyle} />
        <span style={commandTextStyle}>{commandName}</span>
      </div>
    </div>
  );
};


const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [viewBox, setViewBox] = useState("-5000 -3000 10000 6000");
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [recv_num, setRecvNum] = useState(0);
  const [latest_msg, setLatestMsg] = useState<SvgLayerArray>();
  
  // 複数トピックのメッセージ履歴管理
  const [aggregatedMessages, setAggregatedMessages] = useState<Map<number, MessageEvent>>(new Map());
  // 同一ミリ秒に複数の更新が来る可能性に対応するため配列で保持
  const [updateMessages, setUpdateMessages] = useState<Map<number, MessageEvent[]>>(new Map());
  
  // 時間軸管理
  const [seekTime, setSeekTime] = useState<number | undefined>();
  const [currentDisplayMsg, setCurrentDisplayMsg] = useState<SvgLayerArray | undefined>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [refereeData, setRefereeData] = useState<RefereeMessage | undefined>();

  const resetViewBox = useCallback(() => {
    const x = -config.viewBoxWidth / 2;
    const aspectRatio = 0.6; // 元のアスペクト比 (6000 / 10000)
    const height = config.viewBoxWidth * aspectRatio;
    const y = -height / 2;
    setViewBox(`${x} ${y} ${config.viewBoxWidth} ${height}`);
  }, [setViewBox, config]);

  // seekTimeに基づいてメッセージを合成する関数
  const composeMessagesAtTime = useCallback((targetTime: number): SvgLayerArray | undefined => {
    try {
      // 直前のaggregatedメッセージを検索
      let latestAggregatedTime = -1;
      let latestAggregatedMsg: SvgLayerArray | undefined;
      
      for (const [timestamp, message] of aggregatedMessages) {
        if (timestamp <= targetTime && timestamp > latestAggregatedTime) {
          latestAggregatedTime = timestamp;
          latestAggregatedMsg = normalizeSnapshot(message.message);
        }
      }
      
      // ベースとなるレイヤーデータをコピー（バリデーション付き）
      const layerMap = new Map<string, string[]>();
      if (latestAggregatedMsg && latestAggregatedMsg.svg_primitive_arrays) {
        latestAggregatedMsg.svg_primitive_arrays.forEach(array => {
          if (array && array.layer && Array.isArray(array.svg_primitives)) {
            layerMap.set(array.layer, [...array.svg_primitives]);
          }
        });
      }
      
      if (!config.enableUpdateTopic) {
        // updateトピックが無効の場合はaggregatedのみ返す
        return latestAggregatedMsg;
      }
      
      // 適用対象となるupdateメッセージを抽出
      const relevantUpdates: Array<[number, SvgUpdateArray]> = [];
      for (const [timestamp, messagesAtTs] of updateMessages) {
        // latestAggregatedMsg がない場合は履歴の最古から targetTime 以下を採用
        // ある場合は aggregated の直後から targetTime 以下を採用
        const lowerBound = latestAggregatedMsg ? latestAggregatedTime : Number.NEGATIVE_INFINITY;
        if (timestamp > lowerBound && timestamp <= targetTime) {
          for (const message of messagesAtTs) {
            try {
              const updateArray = normalizeUpdates(message.message);
              if (updateArray) relevantUpdates.push([timestamp, updateArray]);
            } catch (error) {
              console.warn(`Invalid update message at timestamp ${timestamp}:`, error);
            }
          }
        }
      }
      
      // 時間順でソート
      relevantUpdates.sort((a, b) => a[0] - b[0]);
      
      // 更新を順次適用
      for (const [timestamp, updateArray] of relevantUpdates) {
        if (!updateArray.updates) continue;
        
        for (const update of updateArray.updates) {
          if (!update || !update.layer || !update.operation) {
            console.warn(`Invalid update in message at timestamp ${timestamp}:`, update);
            continue;
          }
          
          const currentPrimitives = layerMap.get(update.layer) || [];
          
          // フォールバック時（aggregated 不在）には replace/clear のみ適用。append は無視。
          switch (update.operation) {
            case "replace":
              if (Array.isArray(update.svg_primitives)) {
                layerMap.set(update.layer, [...update.svg_primitives]);
              }
              break;
            case "append":
              if (latestAggregatedMsg) {
                if (Array.isArray(update.svg_primitives)) {
                  layerMap.set(update.layer, [...currentPrimitives, ...update.svg_primitives]);
                }
              }
              break;
            case "clear":
              // ベースがなくても clear 自体は適用可能（結果は空レイヤー）
              layerMap.set(update.layer, []);
              break;
            default:
              console.warn(`Unknown operation: ${update.operation}`);
              break;
          }
        }
      }
      
      // 結果をSvgLayerArray形式に変換（空のレイヤーは除外）
      const result: SvgLayerArray = {
        svg_primitive_arrays: Array.from(layerMap.entries())
          .filter(([_, primitives]) => primitives.length > 0)
          .map(([layer, primitives]) => ({
            layer,
            svg_primitives: primitives
          }))
      };
      
      // aggregated が無く、適用後も何も残らない場合は undefined を返す
      if (!latestAggregatedMsg && result.svg_primitive_arrays.length === 0) {
        return undefined;
      }
      return result;
    } catch (error) {
      console.error('Error in composeMessagesAtTime:', error);
      return undefined;
    }
  }, [aggregatedMessages, updateMessages, config.enableUpdateTopic]);

  // 履歴クリーンアップ関数
  const cleanupHistory = useCallback(() => {
    const now = Date.now();
    const cutoffTime = now - (config.maxHistoryDuration * 1000);
    
    // aggregatedMessagesのクリーンアップ
    setAggregatedMessages(prev => {
      const filtered = new Map();
      const entries = Array.from(prev.entries())
        .filter(([timestamp]) => timestamp >= cutoffTime)
        .sort(([a], [b]) => b - a) // 新しい順にソート
        .slice(0, config.maxHistorySize); // 最大サイズで制限
      
      entries.forEach(([timestamp, message]) => {
        filtered.set(timestamp, message);
      });
      
      return filtered;
    });
    
    // updateMessagesのクリーンアップ（配列保持）
    setUpdateMessages(prev => {
      const filtered = new Map<number, MessageEvent[]>();
      const entries = Array.from(prev.entries())
        .filter(([timestamp]) => timestamp >= cutoffTime)
        .sort(([a], [b]) => b - a)
        .slice(0, config.maxHistorySize);
      entries.forEach(([timestamp, msgs]) => {
        filtered.set(timestamp, msgs);
      });
      return filtered;
    });
  }, [config.maxHistoryDuration, config.maxHistorySize]);

  // 定期的なクリーンアップ
  useEffect(() => {
    const interval = setInterval(() => {
      cleanupHistory();
    }, 30000); // 30秒ごとにクリーンアップ
    
    return () => clearInterval(interval);
  }, [cleanupHistory]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "0") {
        const x = -config.viewBoxWidth / 2;
        const aspectRatio = 0.6; // 元のアスペクト比 (6000 / 10000)
        const height = config.viewBoxWidth * aspectRatio;
        const y = -height / 2;
        setViewBox(`${x} ${y} ${config.viewBoxWidth} ${height}`);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [resetViewBox, config]);

  // 複数トピックのサブスクリプション
  useEffect(() => {
    const subscriptions: Subscription[] = [{ topic: config.aggregatedTopic }];
    if (config.enableUpdateTopic) {
      subscriptions.push({ topic: config.updateTopic });
    }
    if (config.enableScoreboard) {
      subscriptions.push({ topic: config.refereeTopic });
    }
    context.subscribe(subscriptions);
  }, [config.aggregatedTopic, config.updateTopic, config.enableUpdateTopic, config.refereeTopic, config.enableScoreboard]);

  useLayoutEffect(() => {
    context.saveState(config);
  }, [config, context]);

  useLayoutEffect(() => {
    const savedConfig = context.initialState as PanelConfig | undefined;
    if (savedConfig) {
      setConfig((prevConfig) => ({ ...prevConfig, ...savedConfig, namespaces: savedConfig.namespaces || prevConfig.namespaces }));
    }
  }, [context, setConfig]);

  useEffect(() => {
    const updatePanelSettings = () => {
      const panelSettings: SettingsTree = {
        nodes: {
          topics: {
            label: "トピック設定",
            fields: {
              aggregatedTopic: { 
                label: "スナップショットトピック", 
                input: "string", 
                value: config.aggregatedTopic,
                help: "完全な状態を含む低頻度トピック" 
              },
              updateTopic: { 
                label: "更新トピック", 
                input: "string", 
                value: config.updateTopic,
                help: "レイヤーごとの更新を含む高頻度トピック" 
              },
              enableUpdateTopic: {
                label: "更新トピック有効",
                input: "boolean",
                value: config.enableUpdateTopic,
                help: "無効にするとスナップショットのみ使用"
              },
              refereeTopic: {
                label: "レフェリートピック",
                input: "string",
                value: config.refereeTopic,
                help: "レフェリー情報のトピック名",
              },
              enableScoreboard: {
                label: "スコアボード表示",
                input: "boolean",
                value: config.enableScoreboard,
                help: "レフェリー情報のスコアボードオーバーレイ",
              },
            },
          },
          performance: {
            label: "パフォーマンス設定",
            fields: {
              maxHistoryDuration: { 
                label: "履歴保持期間(秒)", 
                input: "number", 
                value: config.maxHistoryDuration,
                help: "この秒数より古いメッセージは自動削除" 
              },
              maxHistorySize: { 
                label: "最大履歴サイズ", 
                input: "number", 
                value: config.maxHistorySize,
                help: "保持するメッセージの最大数" 
              },
            },
          },
          display: {
            label: "表示設定",
            fields: {
              backgroundColor: { 
                label: "背景色", 
                input: "rgba", 
                value: config.backgroundColor 
              },
              viewBoxWidth: { 
                label: "ViewBox 幅", 
                input: "number", 
                value: config.viewBoxWidth,
                help: "表示範囲の幅（ズームレベルに影響）" 
              },
            },
          },
          namespaces: {
            label: "名前空間（レイヤー表示制御）",
            fields: createNamespaceFields(config.namespaces),
          },
        },
        actionHandler: (action: SettingsTreeAction) => {
          const path = action.payload.path.join(".");
          switch (action.action) {
            case "update":
              if (path == "topics.aggregatedTopic") {
                setConfig((prevConfig) => ({ ...prevConfig, aggregatedTopic: action.payload.value as string }));
              } else if (path == "topics.updateTopic") {
                setConfig((prevConfig) => ({ ...prevConfig, updateTopic: action.payload.value as string }));
              } else if (path == "topics.enableUpdateTopic") {
                setConfig((prevConfig) => ({ ...prevConfig, enableUpdateTopic: action.payload.value as boolean }));
              } else if (path == "topics.refereeTopic") {
                setConfig((prevConfig) => ({ ...prevConfig, refereeTopic: action.payload.value as string }));
              } else if (path == "topics.enableScoreboard") {
                setConfig((prevConfig) => ({ ...prevConfig, enableScoreboard: action.payload.value as boolean }));
              } else if (path == "performance.maxHistoryDuration") {
                setConfig((prevConfig) => ({ ...prevConfig, maxHistoryDuration: action.payload.value as number }));
              } else if (path == "performance.maxHistorySize") {
                setConfig((prevConfig) => ({ ...prevConfig, maxHistorySize: action.payload.value as number }));
              } else if (path == "display.backgroundColor") {
                setConfig((prevConfig) => ({ ...prevConfig, backgroundColor: action.payload.value as string }));
              } else if (path == "display.viewBoxWidth") {
                setConfig((prevConfig) => ({ ...prevConfig, viewBoxWidth: action.payload.value as number }));
              } else if (path == "display.viewBoxHeight") {
                setConfig((prevConfig) => ({ ...prevConfig, viewBoxHeight: action.payload.value as number }));
              }
              else if (action.payload.path[0] == "namespaces") {
                const pathParts = path.split(".");
                const namespacePath = pathParts.slice(1, -1);
                const leafNamespace = pathParts[pathParts.length - 1];
                let currentNs = config.namespaces;
                for (const ns of namespacePath) {
                  currentNs = currentNs[ns].children || {};
                }
                currentNs[leafNamespace].visible = action.payload.value as boolean;
              }
              break;
            case "perform-node-action":
              break;
          }
        },
      };
      context.updatePanelSettingsEditor(panelSettings);
    };

    updatePanelSettings();
  }, [context, config]);

  const createNamespaceFields = (namespaces: PanelConfig["namespaces"]) => {
    const fields: { [key: string]: SettingsTreeField } = {};
    const addFieldsRecursive = (ns: { [key: string]: any }, path: string[] = []) => {
      for (const [name, { visible, children }] of Object.entries(ns)) {
        const currentPath = [...path, name];
        const key = currentPath.join(".");
        fields[key] = {
          label: name,
          input: "boolean",
          value: visible,
          help: "名前空間の表示/非表示",
        };
        if (children) {
          addFieldsRecursive(children, currentPath);
        }
      }
    };
    addFieldsRecursive(namespaces);
    return fields;
  };


  // メッセージ受信時の処理
  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setMessages(renderState.currentFrame);
      setTopics(renderState.topics);
      
      // 現在時刻の更新を検出
      if (renderState.currentTime !== undefined) {
        const newCurrentTime = renderState.currentTime.sec * 1000 + renderState.currentTime.nsec / 1000000;
        setSeekTime(newCurrentTime);
      }
    };

    context.watch("topics");
    context.watch("currentFrame");
    context.watch("currentTime");

  }, [context]);

  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        const timestamp = message.receiveTime.sec * 1000 + message.receiveTime.nsec / 1000000;
        
        if (message.topic === config.aggregatedTopic) {
        const msg = normalizeSnapshot(message.message);
        
        // aggregatedメッセージの履歴保存
        setAggregatedMessages(prev => new Map(prev.set(timestamp, message)));
        
        // 最新のメッセージを設定
        if (msg) setLatestMsg(msg);
        setRecvNum(recv_num + 1);

        // 初期化時にconfig.namespacesを設定
        setConfig((prevConfig) => {
          const newNamespaces = { ...prevConfig.namespaces };
          msg?.svg_primitive_arrays.forEach((svg_primitive_array) => {
            if (!newNamespaces[svg_primitive_array.layer]) {
              newNamespaces[svg_primitive_array.layer] = { visible: true };
            }
          });
          return { ...prevConfig, namespaces: newNamespaces };
        });
        } else if (config.enableUpdateTopic && message.topic === config.updateTopic) {
          // updateメッセージの履歴保存（同一msに複数を保持）
          setUpdateMessages(prev => {
            const map = new Map(prev);
            const arr = map.get(timestamp) ?? [];
            arr.push(message);
            map.set(timestamp, arr);
            return map;
          });
        } else if (config.enableScoreboard && message.topic === config.refereeTopic) {
          setRefereeData(message.message as unknown as RefereeMessage);
        }
      }
    }
  }, [messages, config.aggregatedTopic, config.updateTopic, config.enableUpdateTopic, config.refereeTopic, config.enableScoreboard]);

  // seekTimeが変更された時のメッセージ合成処理
  useEffect(() => {
    if (seekTime !== undefined) {
      const composedMsg = composeMessagesAtTime(seekTime);
      setCurrentDisplayMsg(composedMsg);
      
      // ネームスペースの初期化
      if (composedMsg) {
        setConfig((prevConfig) => {
          const newNamespaces = { ...prevConfig.namespaces };
          composedMsg.svg_primitive_arrays.forEach((svg_primitive_array) => {
            if (!newNamespaces[svg_primitive_array.layer]) {
              newNamespaces[svg_primitive_array.layer] = { visible: true };
            }
          });
          return { ...prevConfig, namespaces: newNamespaces };
        });
      }
    }
  }, [seekTime, composeMessagesAtTime]);

  // リアルタイム更新用：メッセージ到着時に最新時刻で合成（シーク未実行時）
  useEffect(() => {
    if (!config.enableUpdateTopic) return;
    if (seekTime !== undefined) return; // シーク中は上のエフェクトに任せる
    // 最新のタイムスタンプを選択
    let latestTs = -1;
    for (const [ts] of aggregatedMessages) {
      if (ts > latestTs) latestTs = ts;
    }
    for (const [ts] of updateMessages) {
      if (ts > latestTs) latestTs = ts;
    }
    if (latestTs >= 0) {
      const composed = composeMessagesAtTime(latestTs);
      setCurrentDisplayMsg(composed);
    }
  }, [messages, aggregatedMessages, updateMessages, seekTime, config.enableUpdateTopic, composeMessagesAtTime]);

  // シーク時（currentTime 定義時）も、メッセージ到着で同じ時刻の合成を更新
  useEffect(() => {
    if (!config.enableUpdateTopic) return;
    if (seekTime === undefined) return;
    const composed = composeMessagesAtTime(seekTime);
    setCurrentDisplayMsg(composed);
  }, [messages, aggregatedMessages, updateMessages, seekTime, config.enableUpdateTopic, composeMessagesAtTime]);

  // invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  // currentDisplayMsg に含まれる新規レイヤーを namespaces に反映
  useEffect(() => {
    if (!currentDisplayMsg) return;
    setConfig((prevConfig) => {
      const newNamespaces = { ...prevConfig.namespaces };
      currentDisplayMsg.svg_primitive_arrays.forEach((svg_primitive_array) => {
        if (!newNamespaces[svg_primitive_array.layer]) {
          newNamespaces[svg_primitive_array.layer] = { visible: true };
        }
      });
      return { ...prevConfig, namespaces: newNamespaces };
    });
  }, [currentDisplayMsg]);

  const handleCheckboxChange = (layer: string) => {
    setConfig((prevConfig) => {
      const newNamespaces = { ...prevConfig.namespaces };
      if (!newNamespaces[layer]) {
        newNamespaces[layer] = { visible: true };
      }
      newNamespaces[layer].visible = !newNamespaces[layer].visible;
      return { ...prevConfig, namespaces: newNamespaces };
    });
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={viewBox}
          style={{ backgroundColor: config.backgroundColor }}
          onMouseDown={(e) => {
            const startX = e.clientX;
            const startY = e.clientY;
            const [x, y, width, height] = viewBox.split(" ").map(Number);
            const rect = svgRef.current?.getBoundingClientRect();
            const svgPixelWidth = rect?.width ?? width;
            const svgPixelHeight = rect?.height ?? height;
            const handleMouseMove = (e: MouseEvent) => {
              const dx = e.clientX - startX;
              const dy = e.clientY - startY;
              const scaledDx = dx * (width / svgPixelWidth);
              const scaledDy = dy * (height / svgPixelHeight);
              setViewBox(`${x - scaledDx} ${y - scaledDy} ${width} ${height}`);
            };
            const handleMouseUp = () => {
              document.removeEventListener("mousemove", handleMouseMove);
              document.removeEventListener("mouseup", handleMouseUp);
            };
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
          }}
          onWheel={(e) => {
            e.preventDefault();
            const [x, y, width, height] = viewBox.split(" ").map(Number);
            const scale = e.deltaY > 0 ? 1.2 : 0.8;
            let newWidth = width * scale;
            let newHeight = height * scale;
            const minWidth = width / 10;
            const maxWidth = width * 10;
            const minHeight = height / 10;
            const maxHeight = height * 10;

            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

            const centerX = x + width / 2;
            const centerY = y + height / 2;
            const newX = centerX - newWidth / 2;
            const newY = centerY - newHeight / 2;
            setViewBox(`${newX} ${newY} ${newWidth} ${newHeight}`);
          }}
        >
          {(() => {
            // 更新トピック有効時は合成結果を優先（シーク有無に関わらず）
            const displayMsg = config.enableUpdateTopic
              ? (currentDisplayMsg ?? latest_msg)
              : latest_msg;
            
            return displayMsg?.svg_primitive_arrays.map((svg_primitive_array, index) => (
              <g key={svg_primitive_array.layer} style={{ display: config.namespaces[svg_primitive_array.layer]?.visible ? 'block' : 'none' }}>
                {svg_primitive_array.svg_primitives.map((svg_primitive, index) => (
                  <g dangerouslySetInnerHTML={{ __html: svg_primitive }} />
                ))}
              </g>
            ));
          })()}
        </svg>
        {config.enableScoreboard && refereeData && (
          <ScoreboardOverlay refereeData={refereeData} />
        )}
      </div>
    </div>
  );
};

export function initPanel(context: PanelExtensionContext): () => void {
  ReactDOM.render(
    <StrictMode>
      <CraneVisualizer context={context} />
    </StrictMode>,
    context.panelElement,
  );
  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}
