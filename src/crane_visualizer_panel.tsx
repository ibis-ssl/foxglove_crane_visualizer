import * as React from "react";
import { useCallback, useLayoutEffect, useRef, useState, useEffect } from "react";
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

// grSimリプレイスメント関連インターフェース
interface GrSimBallReplacement {
  x: number;
  y: number;
  vx: number;
  vy: number;
  has_field: number;
}

interface GrSimRobotReplacement {
  x: number;
  y: number;
  dir: number;
  id: number;
  yellowteam: boolean;
  turnon: boolean;
  has_field: number;
}

interface GrSimReplacement {
  ball: GrSimBallReplacement;
  robots: GrSimRobotReplacement[];
  has_field: number;
}

type GrSimPlacementMode =
  | { type: "none" }
  | { type: "ball" }
  | { type: "robot"; team: "yellow" | "blue"; id: number };

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

type PrimitiveCommand = {
  type: "circle" | "line" | "rect" | "text" | "polyline" | "polygon" | "path";
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  cx?: number;
  cy?: number;
  r?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
  text?: string;
  fontSize?: number;
  textAnchor?: CanvasTextAlign;
  path?: Path2D;
};

const SVG_ATTR_RE = {
  fill: /(?:^|\s)fill="([^"]*)"/,
  fillOpacity: /fill-opacity="([^"]*)"/,
  stroke: /(?:^|\s)stroke="([^"]*)"/,
  strokeOpacity: /stroke-opacity="([^"]*)"/,
  strokeWidth: /stroke-width="([^"]*)"/,
  cx: /(?:^|\s)cx="([^"]*)"/,
  cy: /(?:^|\s)cy="([^"]*)"/,
  r: /(?:^|\s)r="([^"]*)"/,
  x1: /(?:^|\s)x1="([^"]*)"/,
  y1: /(?:^|\s)y1="([^"]*)"/,
  x2: /(?:^|\s)x2="([^"]*)"/,
  y2: /(?:^|\s)y2="([^"]*)"/,
  x: /(?:^|\s)x="([^"]*)"/,
  y: /(?:^|\s)y="([^"]*)"/,
  width: /(?:^|\s)width="([^"]*)"/,
  height: /(?:^|\s)height="([^"]*)"/,
  points: /(?:^|\s)points="([^"]*)"/,
  d: /(?:^|\s)d="([^"]*)"/,
  fontSize: /font-size="([^"]*)"/,
  textAnchor: /text-anchor="([^"]*)"/,
  textContent: /<text[^>]*>([\s\S]*?)<\/text>/,
} as const;

const readNumberAttr = (s: string, re: RegExp, fallback = 0): number => {
  const match = re.exec(s);
  if (!match) return fallback;
  const value = Number.parseFloat(match[1] ?? "");
  return Number.isFinite(value) ? value : fallback;
};

const readStringAttr = (s: string, re: RegExp, fallback = ""): string => {
  const match = re.exec(s);
  return match?.[1] ?? fallback;
};

const parsePoints = (pointsStr: string): Array<{ x: number; y: number }> => {
  const nums = pointsStr
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    points.push({ x: nums[i]!, y: nums[i + 1]! });
  }
  return points;
};

const parsePrimitiveCommand = (primitive: string): PrimitiveCommand | undefined => {
  const s = primitive.trim();
  const style = {
    fill: readStringAttr(s, SVG_ATTR_RE.fill, "none"),
    fillOpacity: readNumberAttr(s, SVG_ATTR_RE.fillOpacity, 1),
    stroke: readStringAttr(s, SVG_ATTR_RE.stroke, "none"),
    strokeOpacity: readNumberAttr(s, SVG_ATTR_RE.strokeOpacity, 1),
    strokeWidth: readNumberAttr(s, SVG_ATTR_RE.strokeWidth, 1),
  };

  if (s.startsWith("<circle")) {
    return {
      type: "circle",
      cx: readNumberAttr(s, SVG_ATTR_RE.cx),
      cy: readNumberAttr(s, SVG_ATTR_RE.cy),
      r: readNumberAttr(s, SVG_ATTR_RE.r),
      ...style,
    };
  }
  if (s.startsWith("<line")) {
    return {
      type: "line",
      x1: readNumberAttr(s, SVG_ATTR_RE.x1),
      y1: readNumberAttr(s, SVG_ATTR_RE.y1),
      x2: readNumberAttr(s, SVG_ATTR_RE.x2),
      y2: readNumberAttr(s, SVG_ATTR_RE.y2),
      ...style,
    };
  }
  if (s.startsWith("<rect")) {
    return {
      type: "rect",
      x: readNumberAttr(s, SVG_ATTR_RE.x),
      y: readNumberAttr(s, SVG_ATTR_RE.y),
      width: readNumberAttr(s, SVG_ATTR_RE.width),
      height: readNumberAttr(s, SVG_ATTR_RE.height),
      ...style,
    };
  }
  if (s.startsWith("<polyline")) {
    return {
      type: "polyline",
      points: parsePoints(readStringAttr(s, SVG_ATTR_RE.points)),
      ...style,
      fill: "none",
    };
  }
  if (s.startsWith("<polygon")) {
    return {
      type: "polygon",
      points: parsePoints(readStringAttr(s, SVG_ATTR_RE.points)),
      ...style,
    };
  }
  if (s.startsWith("<path")) {
    const d = readStringAttr(s, SVG_ATTR_RE.d);
    if (!d) return undefined;
    return {
      type: "path",
      path: new Path2D(d),
      ...style,
    };
  }
  if (s.startsWith("<text")) {
    const textAnchorRaw = readStringAttr(s, SVG_ATTR_RE.textAnchor, "start");
    const textAnchor: CanvasTextAlign =
      textAnchorRaw === "middle" ? "center" : textAnchorRaw === "end" ? "right" : "left";
    return {
      type: "text",
      x: readNumberAttr(s, SVG_ATTR_RE.x),
      y: readNumberAttr(s, SVG_ATTR_RE.y),
      text: readStringAttr(s, SVG_ATTR_RE.textContent),
      fontSize: readNumberAttr(s, SVG_ATTR_RE.fontSize, 100),
      textAnchor,
      fill: readStringAttr(s, SVG_ATTR_RE.fill, "#ffffff"),
      fillOpacity: readNumberAttr(s, SVG_ATTR_RE.fillOpacity, 1),
    };
  }
  return undefined;
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
  grsimEnabled: boolean; // grSim制御の有効/無効
  grsimReplacementTopic: string; // grSimリプレイスメントトピック
  grsimDefaultRobotDir: number; // デフォルトロボット方向（度）
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
  grsimEnabled: true,
  grsimReplacementTopic: "/replacement",
  grsimDefaultRobotDir: 0,
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


// grSimツールバーカラーパレット
const GRSIM_COLORS = {
  bg: "rgba(10, 10, 20, 0.85)",
  border: "rgba(255, 255, 255, 0.1)",
  text: "#FFFFFF",
  textDim: "rgba(255, 255, 255, 0.6)",
  yellow: "#FFD700",
  blue: "#4D9FFF",
  ball: "#FF8C00",
  activeBtn: "rgba(255, 255, 255, 0.2)",
  hoverBtn: "rgba(255, 255, 255, 0.1)",
  warning: "#FF6B6B",
} as const;

const GrSimToolbar: React.FC<{
  currentMode: GrSimPlacementMode;
  onModeChange: (mode: GrSimPlacementMode) => void;
  robotDir: number;
  onRobotDirChange: (dir: number) => void;
  publishSupported: boolean;
}> = ({ currentMode, onModeChange, robotDir, onRobotDirChange, publishSupported }) => {
  const containerStyle: React.CSSProperties = {
    position: "absolute",
    top: 12,
    left: 12,
    pointerEvents: "auto",
    zIndex: 100,
    fontFamily: "'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif",
    background: GRSIM_COLORS.bg,
    border: `1px solid ${GRSIM_COLORS.border}`,
    borderRadius: 10,
    boxShadow: "0 4px 24px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)",
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: GRSIM_COLORS.text,
    letterSpacing: 1,
    marginRight: 4,
  };

  const btnStyle = (active: boolean, color?: string): React.CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    border: active ? `1px solid ${color ?? GRSIM_COLORS.text}` : `1px solid ${GRSIM_COLORS.border}`,
    background: active ? (color ? `${color}30` : GRSIM_COLORS.activeBtn) : "transparent",
    color: active ? (color ?? GRSIM_COLORS.text) : GRSIM_COLORS.textDim,
    cursor: publishSupported ? "pointer" : "not-allowed",
    opacity: publishSupported ? 1 : 0.5,
    transition: "all 0.15s ease",
  });

  const selectStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    padding: "3px 6px",
    borderRadius: 6,
    border: `1px solid ${GRSIM_COLORS.border}`,
    background: "rgba(255,255,255,0.05)",
    color: GRSIM_COLORS.text,
    cursor: publishSupported ? "pointer" : "not-allowed",
    opacity: publishSupported ? 1 : 0.5,
  };

  const dirInputStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    padding: "3px 6px",
    borderRadius: 6,
    border: `1px solid ${GRSIM_COLORS.border}`,
    background: "rgba(255,255,255,0.05)",
    color: GRSIM_COLORS.text,
    width: 50,
    textAlign: "center" as const,
  };

  const warningStyle: React.CSSProperties = {
    fontSize: 11,
    color: GRSIM_COLORS.warning,
    fontWeight: 600,
  };

  const isBallActive = currentMode.type === "ball";
  const isYellowActive = currentMode.type === "robot" && currentMode.team === "yellow";
  const isBlueActive = currentMode.type === "robot" && currentMode.team === "blue";

  const handleBallClick = () => {
    if (!publishSupported) return;
    onModeChange(isBallActive ? { type: "none" } : { type: "ball" });
  };

  const handleYellowSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!publishSupported) return;
    const id = parseInt(e.target.value, 10);
    if (isNaN(id)) {
      onModeChange({ type: "none" });
    } else {
      onModeChange({ type: "robot", team: "yellow", id });
    }
  };

  const handleBlueSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!publishSupported) return;
    const id = parseInt(e.target.value, 10);
    if (isNaN(id)) {
      onModeChange({ type: "none" });
    } else {
      onModeChange({ type: "robot", team: "blue", id });
    }
  };

  const yellowSelectValue = isYellowActive ? String(currentMode.id) : "";
  const blueSelectValue = isBlueActive ? String(currentMode.id) : "";

  const robotIds = Array.from({ length: 16 }, (_, i) => i);

  return (
    <div style={containerStyle} onMouseDown={(e) => e.stopPropagation()}>
      <div style={rowStyle}>
        <span style={labelStyle}>grSim</span>
        <button style={btnStyle(isBallActive, GRSIM_COLORS.ball)} onClick={handleBallClick}>
          Ball
        </button>
        <select
          style={{ ...selectStyle, ...(isYellowActive ? { borderColor: GRSIM_COLORS.yellow, color: GRSIM_COLORS.yellow } : {}) }}
          value={yellowSelectValue}
          onChange={handleYellowSelect}
          disabled={!publishSupported}
        >
          <option value="" style={{ background: "#222", color: "#fff" }}>Yellow ▼</option>
          {robotIds.map((id) => (
            <option key={id} value={String(id)} style={{ background: "#222", color: "#fff" }}>Y{id}</option>
          ))}
        </select>
        <select
          style={{ ...selectStyle, ...(isBlueActive ? { borderColor: GRSIM_COLORS.blue, color: GRSIM_COLORS.blue } : {}) }}
          value={blueSelectValue}
          onChange={handleBlueSelect}
          disabled={!publishSupported}
        >
          <option value="" style={{ background: "#222", color: "#fff" }}>Blue ▼</option>
          {robotIds.map((id) => (
            <option key={id} value={String(id)} style={{ background: "#222", color: "#fff" }}>B{id}</option>
          ))}
        </select>
      </div>
      {currentMode.type === "robot" && (
        <div style={rowStyle}>
          <span style={{ ...labelStyle, fontSize: 11 }}>Dir:</span>
          <input
            type="number"
            style={dirInputStyle}
            value={robotDir}
            onChange={(e) => onRobotDirChange(Number(e.target.value))}
            min={-180}
            max={180}
            step={15}
          />
          <span style={{ fontSize: 11, color: GRSIM_COLORS.textDim }}>°</span>
        </div>
      )}
      {!publishSupported && (
        <div style={warningStyle}>Publish非対応（ファイル再生中?）</div>
      )}
    </div>
  );
};

const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [viewBox, setViewBox] = useState("-5000 -3000 10000 6000");
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [latest_msg, setLatestMsg] = useState<SvgLayerArray>();
  
  // 複数トピックのメッセージ履歴管理
  const [aggregatedMessages, setAggregatedMessages] = useState<Map<number, MessageEvent>>(new Map());
  // 同一ミリ秒に複数の更新が来る可能性に対応するため配列で保持
  const [updateMessages, setUpdateMessages] = useState<Map<number, MessageEvent[]>>(new Map());
  
  // 時間軸管理
  const [seekTime, setSeekTime] = useState<number | undefined>();
  const [currentDisplayMsg, setCurrentDisplayMsg] = useState<SvgLayerArray | undefined>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const [refereeData, setRefereeData] = useState<RefereeMessage | undefined>();
  const primitiveCacheRef = useRef<Map<string, PrimitiveCommand | undefined>>(new Map());
  const pendingUpdateMessagesRef = useRef<MessageEvent[]>([]);
  const coalesceTimerRef = useRef<number | undefined>(undefined);
  const redrawNeededRef = useRef(true);

  // grSim制御用状態
  const [grsimMode, setGrsimMode] = useState<GrSimPlacementMode>({ type: "none" });
  const [cursorSvgPos, setCursorSvgPos] = useState<{ x: number; y: number } | null>(null);
  const [publishSupported, setPublishSupported] = useState(false);
  const [robotDir, setRobotDir] = useState(0);

  // grSim advertise/unadvertise管理
  useEffect(() => {
    if (!config.grsimEnabled) {
      setPublishSupported(false);
      return;
    }
    if (!context.advertise) {
      setPublishSupported(false);
      return;
    }
    try {
      context.advertise(config.grsimReplacementTopic, "robocup_ssl_msgs/msg/GrSimReplacement");
      setPublishSupported(true);
    } catch (e) {
      console.warn("grSim advertise failed:", e);
      setPublishSupported(false);
    }
    return () => {
      try {
        context.unadvertise?.(config.grsimReplacementTopic);
      } catch (e) {
        console.warn("grSim unadvertise failed:", e);
      }
      setPublishSupported(false);
    };
  }, [context, config.grsimEnabled, config.grsimReplacementTopic]);

  // grsimDefaultRobotDirの変更時にrobotDirを同期
  useEffect(() => {
    setRobotDir(config.grsimDefaultRobotDir);
  }, [config.grsimDefaultRobotDir]);

  const invalidateRedraw = useCallback(() => {
    redrawNeededRef.current = true;
  }, []);

  const parseViewBox = useCallback((): { x: number; y: number; width: number; height: number } => {
    const [x, y, width, height] = viewBox.split(" ").map(Number);
    return { x, y, width, height };
  }, [viewBox]);

  const getCanvasViewport = useCallback(
    (canvasRect: { width: number; height: number }, vb: { x: number; y: number; width: number; height: number }) => {
      const scale = Math.min(canvasRect.width / vb.width, canvasRect.height / vb.height);
      const offsetX = (canvasRect.width - vb.width * scale) / 2;
      const offsetY = (canvasRect.height - vb.height * scale) / 2;
      return { scale, offsetX, offsetY };
    },
    [],
  );

  const getOrParsePrimitive = useCallback((primitive: string): PrimitiveCommand | undefined => {
    const cache = primitiveCacheRef.current;
    if (cache.has(primitive)) {
      return cache.get(primitive);
    }
    const cmd = parsePrimitiveCommand(primitive);
    if (cache.size >= 20000) {
      const keys = Array.from(cache.keys()).slice(0, 5000);
      keys.forEach((key) => cache.delete(key));
    }
    cache.set(primitive, cmd);
    return cmd;
  }, []);

  const screenToSvgCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const vb = parseViewBox();
    const { scale, offsetX, offsetY } = getCanvasViewport(rect, vb);
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const svgX = vb.x + (px - offsetX) / scale;
    const svgY = vb.y + (py - offsetY) / scale;
    return { x: svgX, y: svgY };
  }, [getCanvasViewport, parseViewBox]);

  const drawPrimitive = useCallback((ctx: CanvasRenderingContext2D, cmd: PrimitiveCommand) => {
    const applyFill = () => {
      if (cmd.fill && cmd.fill !== "none") {
        ctx.globalAlpha = cmd.fillOpacity ?? 1;
        ctx.fillStyle = cmd.fill;
        ctx.fill();
      }
    };
    const applyStroke = () => {
      if (cmd.stroke && cmd.stroke !== "none") {
        ctx.globalAlpha = cmd.strokeOpacity ?? 1;
        ctx.strokeStyle = cmd.stroke;
        ctx.lineWidth = cmd.strokeWidth ?? 1;
        ctx.stroke();
      }
    };

    ctx.save();
    ctx.globalAlpha = 1;
    if (cmd.type === "circle") {
      ctx.beginPath();
      ctx.arc(cmd.cx ?? 0, cmd.cy ?? 0, cmd.r ?? 0, 0, Math.PI * 2);
      applyFill();
      applyStroke();
    } else if (cmd.type === "line") {
      ctx.beginPath();
      ctx.moveTo(cmd.x1 ?? 0, cmd.y1 ?? 0);
      ctx.lineTo(cmd.x2 ?? 0, cmd.y2 ?? 0);
      applyStroke();
    } else if (cmd.type === "rect") {
      ctx.beginPath();
      ctx.rect(cmd.x ?? 0, cmd.y ?? 0, cmd.width ?? 0, cmd.height ?? 0);
      applyFill();
      applyStroke();
    } else if (cmd.type === "polyline") {
      const points = cmd.points ?? [];
      if (points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i]!.x, points[i]!.y);
        }
        applyStroke();
      }
    } else if (cmd.type === "polygon") {
      const points = cmd.points ?? [];
      if (points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i]!.x, points[i]!.y);
        }
        ctx.closePath();
        applyFill();
        applyStroke();
      }
    } else if (cmd.type === "path" && cmd.path) {
      if (cmd.fill && cmd.fill !== "none") {
        ctx.globalAlpha = cmd.fillOpacity ?? 1;
        ctx.fillStyle = cmd.fill;
        ctx.fill(cmd.path);
      }
      if (cmd.stroke && cmd.stroke !== "none") {
        ctx.globalAlpha = cmd.strokeOpacity ?? 1;
        ctx.strokeStyle = cmd.stroke;
        ctx.lineWidth = cmd.strokeWidth ?? 1;
        ctx.stroke(cmd.path);
      }
    } else if (cmd.type === "text") {
      ctx.globalAlpha = cmd.fillOpacity ?? 1;
      ctx.fillStyle = cmd.fill ?? "#fff";
      ctx.font = `${cmd.fontSize ?? 100}px sans-serif`;
      ctx.textAlign = cmd.textAnchor ?? "left";
      ctx.textBaseline = "middle";
      ctx.fillText(cmd.text ?? "", cmd.x ?? 0, cmd.y ?? 0);
    }
    ctx.restore();
  }, []);

  const drawCanvasScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const desiredWidth = Math.max(1, Math.round(rect.width * dpr));
    const desiredHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
      canvas.width = desiredWidth;
      canvas.height = desiredHeight;
    }

    const vb = parseViewBox();
    const displayMsg = config.enableUpdateTopic ? (currentDisplayMsg ?? latest_msg) : latest_msg;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.clip();

    const { scale, offsetX, offsetY } = getCanvasViewport(rect, vb);
    ctx.setTransform(
      scale * dpr,
      0,
      0,
      scale * dpr,
      (offsetX - vb.x * scale) * dpr,
      (offsetY - vb.y * scale) * dpr,
    );

    displayMsg?.svg_primitive_arrays.forEach((layerArray) => {
      if (!config.namespaces[layerArray.layer]?.visible) return;
      layerArray.svg_primitives.forEach((primitive) => {
        const cmd = getOrParsePrimitive(primitive);
        if (cmd) drawPrimitive(ctx, cmd);
      });
    });

    if (config.grsimEnabled && grsimMode.type !== "none" && cursorSvgPos) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      if (grsimMode.type === "ball") {
        ctx.beginPath();
        ctx.arc(cursorSvgPos.x, cursorSvgPos.y, 43, 0, Math.PI * 2);
        ctx.fillStyle = "#FF8C00";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#FFA500";
        ctx.stroke();
      } else if (grsimMode.type === "robot") {
        ctx.beginPath();
        ctx.arc(cursorSvgPos.x, cursorSvgPos.y, 90, 0, Math.PI * 2);
        ctx.fillStyle = grsimMode.team === "yellow" ? "#FFD700" : "#4D9FFF";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = grsimMode.team === "yellow" ? "#DAA520" : "#2070CC";
        ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.font = "bold 70px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(grsimMode.id), cursorSvgPos.x, cursorSvgPos.y);
      }
      ctx.restore();
    }

    ctx.restore();
  }, [
    config.backgroundColor,
    config.enableUpdateTopic,
    config.grsimEnabled,
    config.namespaces,
    currentDisplayMsg,
    cursorSvgPos,
    drawPrimitive,
    getOrParsePrimitive,
    getCanvasViewport,
    grsimMode,
    latest_msg,
    parseViewBox,
  ]);

  useEffect(() => {
    redrawNeededRef.current = true;
  }, [
    viewBox,
    config.backgroundColor,
    config.enableUpdateTopic,
    config.grsimEnabled,
    config.namespaces,
    currentDisplayMsg,
    latest_msg,
    cursorSvgPos,
    grsimMode,
  ]);

  useEffect(() => {
    let rafId = 0;
    const loop = () => {
      if (redrawNeededRef.current) {
        redrawNeededRef.current = false;
        drawCanvasScene();
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [drawCanvasScene]);

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
      } else if (event.key === "Escape") {
        setGrsimMode({ type: "none" });
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
          grsim: {
            label: "grSim制御",
            fields: {
              grsimEnabled: {
                label: "grSim制御有効",
                input: "boolean",
                value: config.grsimEnabled,
                help: "grSimシミュレータのボール/ロボット配置制御",
              },
              grsimReplacementTopic: {
                label: "リプレイスメントトピック",
                input: "string",
                value: config.grsimReplacementTopic,
                help: "grSimリプレイスメントメッセージの発行先トピック",
                disabled: !config.grsimEnabled,
              },
              grsimDefaultRobotDir: {
                label: "デフォルトロボット方向(°)",
                input: "number",
                value: config.grsimDefaultRobotDir,
                help: "ロボット配置時のデフォルト方向（-180〜180度）",
                disabled: !config.grsimEnabled,
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
              } else if (path == "grsim.grsimEnabled") {
                setConfig((prevConfig) => ({ ...prevConfig, grsimEnabled: action.payload.value as boolean }));
              } else if (path == "grsim.grsimReplacementTopic") {
                setConfig((prevConfig) => ({ ...prevConfig, grsimReplacementTopic: action.payload.value as string }));
              } else if (path == "grsim.grsimDefaultRobotDir") {
                setConfig((prevConfig) => ({ ...prevConfig, grsimDefaultRobotDir: action.payload.value as number }));
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
          // updateメッセージは50msでコアレスして反映
          pendingUpdateMessagesRef.current.push(message);
          if (coalesceTimerRef.current === undefined) {
            coalesceTimerRef.current = window.setTimeout(() => {
              const batch = pendingUpdateMessagesRef.current.splice(0);
              coalesceTimerRef.current = undefined;
              if (batch.length === 0) return;
              setUpdateMessages((prev) => {
                const map = new Map(prev);
                batch.forEach((updateMessage) => {
                  const updateTs =
                    updateMessage.receiveTime.sec * 1000 + updateMessage.receiveTime.nsec / 1000000;
                  const arr = map.get(updateTs) ?? [];
                  arr.push(updateMessage);
                  map.set(updateTs, arr);
                });
                return map;
              });
            }, 50);
          }
        } else if (config.enableScoreboard && message.topic === config.refereeTopic) {
          setRefereeData(message.message as unknown as RefereeMessage);
        }
      }
    }
  }, [messages, config.aggregatedTopic, config.updateTopic, config.enableUpdateTopic, config.refereeTopic, config.enableScoreboard]);

  useEffect(() => {
    return () => {
      if (coalesceTimerRef.current !== undefined) {
        window.clearTimeout(coalesceTimerRef.current);
      }
    };
  }, []);

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

  // SVG座標(mm) → grSim座標(m)
  const svgToGrsimCoords = useCallback((svgX: number, svgY: number): { x: number; y: number } => ({
    x: svgX / 1000,
    y: -svgY / 1000, // SVGのY軸(下が正)をフィールド座標(上が正)に変換
  }), []);

  // grSimリプレイスメントメッセージ発行
  const publishGrsimReplacement = useCallback((svgX: number, svgY: number) => {
    if (!publishSupported || !context.publish) return;
    const { x, y } = svgToGrsimCoords(svgX, svgY);

    let message: GrSimReplacement;
    if (grsimMode.type === "ball") {
      message = {
        ball: { x, y, vx: 0, vy: 0, has_field: 15 }, // X+Y+VX+VY
        robots: [],
        has_field: 1, // BALL_FIELD_SET
      };
    } else if (grsimMode.type === "robot") {
      const dirRad = (robotDir * Math.PI) / 180;
      message = {
        ball: { x: 0, y: 0, vx: 0, vy: 0, has_field: 0 },
        robots: [
          {
            x,
            y,
            dir: dirRad,
            id: grsimMode.id,
            yellowteam: grsimMode.team === "yellow",
            turnon: true,
            has_field: 63, // 全フィールドセット
          },
        ],
        has_field: 0, // ボールなし
      };
    } else {
      return;
    }

    try {
      context.publish(config.grsimReplacementTopic, message);
    } catch (e) {
      console.error("grSim publish failed:", e);
    }
  }, [publishSupported, context, grsimMode, robotDir, svgToGrsimCoords, config.grsimReplacementTopic]);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            cursor: (config.grsimEnabled && grsimMode.type !== "none") ? "crosshair" : "grab",
          }}
          onClick={(e) => {
            if (!config.grsimEnabled || grsimMode.type === "none") return;
            if (isDraggingRef.current) return;
            e.preventDefault();
            const pos = screenToSvgCoords(e.clientX, e.clientY);
            if (pos) {
              publishGrsimReplacement(pos.x, pos.y);
            }
          }}
          onMouseMove={(e) => {
            if (!config.grsimEnabled || grsimMode.type === "none") return;
            const pos = screenToSvgCoords(e.clientX, e.clientY);
            setCursorSvgPos(pos);
          }}
          onMouseLeave={() => {
            setCursorSvgPos(null);
          }}
          onMouseDown={(e) => {
            isDraggingRef.current = false;
            const startX = e.clientX;
            const startY = e.clientY;
            const vb = parseViewBox();
            const rect = canvasRef.current?.getBoundingClientRect();
            const canvasRect = { width: rect?.width ?? vb.width, height: rect?.height ?? vb.height };
            const { scale } = getCanvasViewport(canvasRect, vb);
            const handleMouseMove = (e: MouseEvent) => {
              const dx = e.clientX - startX;
              const dy = e.clientY - startY;
              if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                isDraggingRef.current = true;
              }
              const scaledDx = dx / scale;
              const scaledDy = dy / scale;
              setViewBox(`${vb.x - scaledDx} ${vb.y - scaledDy} ${vb.width} ${vb.height}`);
              invalidateRedraw();
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
            const { x, y, width, height } = parseViewBox();
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
            invalidateRedraw();
          }}
        />
        {config.enableScoreboard && refereeData && (
          <ScoreboardOverlay refereeData={refereeData} />
        )}
        {config.grsimEnabled && (
          <GrSimToolbar
            currentMode={grsimMode}
            onModeChange={setGrsimMode}
            robotDir={robotDir}
            onRobotDirChange={setRobotDir}
            publishSupported={publishSupported}
          />
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
