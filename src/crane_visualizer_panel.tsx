import * as React from "react";
import { useCallback, useLayoutEffect, useRef, useState, useEffect } from "react";
import {
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeField,
  Subscription
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

// ------------------------------------------------------------------
// メッセージ履歴（ts昇順のソート済み配列）
//
// Map<ts, msg> ではなく配列で保持するのは、合成のたびに全走査するのを避けるため。
// 二分探索で [スナップショット直後, 目標時刻] の範囲だけを切り出す。
// ------------------------------------------------------------------
interface HistoryEntry<T> {
  ts: number; // receiveTime（データソース由来の時刻）をミリ秒に換算したもの
  msg: T;
}

/** ts <= target を満たす最後の要素の index。該当なしは -1 */
const lastIndexAtOrBefore = <T,>(entries: HistoryEntry<T>[], target: number): number => {
  let lo = 0;
  let hi = entries.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.ts <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

/** ts >= bound を満たす最初の要素の index。該当なしは entries.length */
const firstIndexAtOrAfter = <T,>(entries: HistoryEntry<T>[], bound: number): number => {
  let lo = 0;
  let hi = entries.length - 1;
  let found = entries.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid]!.ts >= bound) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return found;
};

/** ts昇順を保ったまま追加する。通常は末尾追加で済む（tsはほぼ単調増加） */
const pushHistoryEntry = <T,>(entries: HistoryEntry<T>[], entry: HistoryEntry<T>): void => {
  const last = entries[entries.length - 1];
  if (last === undefined || entry.ts >= last.ts) {
    entries.push(entry);
    return;
  }
  entries.splice(lastIndexAtOrBefore(entries, entry.ts) + 1, 0, entry);
};

/**
 * ts >= target の要素を末尾から削除する（シークで過去に戻ったときに使う）。
 *
 * target と同時刻のエントリまで削るのは、シーク後にデータソースが
 * 「その時刻以前の最新メッセージ」をバックフィル再配信するため。
 * 残すと同一メッセージが二重に積まれ、append が二重適用される。
 */
const truncateHistoryFrom = <T,>(entries: HistoryEntry<T>[], target: number): void => {
  const keep = firstIndexAtOrAfter(entries, target);
  if (keep < entries.length) {
    entries.length = keep;
  }
};

/** ts < cutoff の要素を先頭から削除する */
const dropHistoryBefore = <T,>(entries: HistoryEntry<T>[], cutoff: number): void => {
  const drop = firstIndexAtOrAfter(entries, cutoff);
  if (drop > 0) {
    entries.splice(0, drop);
  }
};

/**
 * 件数上限を超えた分を古い順に削る。ただし ts >= protectFrom のエントリは削らない。
 * 合成の土台（その時刻で使われるスナップショット）とその後続を失わないための安全弁。
 */
const dropOldestKeepingActive = <T,>(
  entries: HistoryEntry<T>[],
  maxEntries: number,
  protectFrom: number | undefined,
): void => {
  const excess = entries.length - maxEntries;
  if (excess <= 0) return;

  const protectedIndex =
    protectFrom === undefined ? entries.length : firstIndexAtOrAfter(entries, protectFrom);
  const removable = Math.min(excess, protectedIndex);
  if (removable > 0) {
    entries.splice(0, removable);
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
  namespaces: NamespaceTree;
}

interface NamespaceNode {
  visible: boolean;
}

// レイヤーは "world/geometry" のようなパス文字列をそのままキーとする1階層で保持する。
// 設定ツリーのフィールドキーもレイヤー名そのものなので、
// action.payload.path[1] がそのままここでのキーになる。
type NamespaceTree = { [key: string]: NamespaceNode };

/**
 * 名前空間の表示状態を不変更新する。
 * 変化が無ければ元の参照をそのまま返す（不要な再レンダーを避けるため）。
 */
const setNamespaceVisible = (
  namespaces: NamespaceTree,
  layer: string,
  visible: boolean,
): NamespaceTree => {
  const node = namespaces[layer];
  if (!node || node.visible === visible) return namespaces;
  return { ...namespaces, [layer]: { ...node, visible } };
};

// updateトピック履歴の絶対上限（エントリ数）。
// updateの保持は原則「時間窓（maxHistoryDuration）」のみで行い、件数では切らない。
// 件数で切ると、最新スナップショットより後ろのupdateに穴が空き、合成結果が
// スナップショット時点まで巻き戻るため。これは異常時の暴走を防ぐ安全弁であり、
// 通常運用（約400Hz × maxHistoryDuration秒）では発動しない。
const UPDATE_HISTORY_HARD_CAP = 100000;

// パース済みSVGプリミティブのLRUキャッシュ容量と、溢れたときの一括追い出し数
const PRIMITIVE_CACHE_MAX_ENTRIES = 20000;
const PRIMITIVE_CACHE_EVICT_COUNT = 5000;

// clear操作などで共有する空プリミティブ配列
const EMPTY_PRIMITIVES: readonly string[] = [];

// 履歴保持期間(秒)の既定値と許容範囲。
// 既定値はスナップショット周期(5秒)の3倍。「最新スナップショット以降の更新が必ず揃っている」
// ことを保証する最小値は2周期であり、それに余裕を持たせている。
// 上限を設けるのは、更新トピックが数百Hz出るため長くするとメモリを直撃するため。
const DEFAULT_HISTORY_DURATION_SEC = 15;
const MIN_HISTORY_DURATION_SEC = 10;
const MAX_HISTORY_DURATION_SEC = 60;

/**
 * 履歴保持期間を安全な範囲に丸める。
 * 旧バージョンが保存したレイアウト（既定300秒）をそのまま復元すると、
 * 更新トピックの実レートでは UPDATE_HISTORY_HARD_CAP を超えてメモリを圧迫し、
 * 本来守るべき「最新スナップショット以降の更新」まで削られかねない。
 */
const clampHistoryDuration = (seconds: number | undefined): number => {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return DEFAULT_HISTORY_DURATION_SEC;
  }
  return Math.min(Math.max(seconds, MIN_HISTORY_DURATION_SEC), MAX_HISTORY_DURATION_SEC);
};

const defaultConfig: PanelConfig = {
  backgroundColor: "#585858ff",
  message: "",
  viewBoxWidth: 10000,
  aggregatedTopic: "/aggregated_svgs",
  updateTopic: "/visualizer_svgs",
  enableUpdateTopic: true,
  maxHistoryDuration: DEFAULT_HISTORY_DURATION_SEC,
  // スナップショット履歴の最大件数。updateトピックには適用しない（UPDATE_HISTORY_HARD_CAP参照）。
  maxHistorySize: 1000,
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

  // メッセージ履歴（ts昇順のソート済み配列）
  //
  // stateではなくrefで保持する。受信は onRender 内で同期的に行い、合成と描画は
  // requestAnimationFrame ループ1本に集約するため、Reactのコミットを挟む必要がない。
  // 挟むと受信から合成までに遅延が生まれ、「新しい再生時刻 × 古い更新集合」で
  // 合成された結果（＝スナップショット時点まで巻き戻った絵）が一瞬表示される。
  const aggregatedHistoryRef = useRef<HistoryEntry<SvgLayerArray>[]>([]);
  const updateHistoryRef = useRef<HistoryEntry<SvgUpdateArray>[]>([]);

  // 時間軸管理
  // 再生時刻(bag時刻, ms)。履歴の合成・クリーンアップはすべてこの時間軸で行う。
  const seekTimeRef = useRef<number | undefined>(undefined);
  // 再生時刻が取れない場合のフォールバック基準（受信済みメッセージのreceiveTime最大値）
  const latestReceivedTsRef = useRef<number | undefined>(undefined);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const [refereeData, setRefereeData] = useState<RefereeMessage | undefined>();
  const primitiveCacheRef = useRef<Map<string, PrimitiveCommand | undefined>>(new Map());
  const redrawNeededRef = useRef(true);
  // onRender から受け取った done。描画を終えたフレームで呼び返す（プレイヤーのバックプレッシャ）
  const pendingDonesRef = useRef<Array<() => void>>([]);
  // namespaces に登録済みのレイヤー。setConfig を新規レイヤー発見時だけに絞るために使う
  const knownLayersRef = useRef<Set<string>>(new Set());
  // onRender / rAFループから最新のconfigを読むためのミラー。
  // レンダー本体ではなくコミット後に更新する。rAFコールバック内の setConfig は
  // React 17 ではバッチされず同期再レンダーを起こすため、レンダー中に代入すると
  // 「refはコミット済みのconfigを指す」という前提がrAFコールバックの途中で崩れる。
  const configRef = useRef<PanelConfig>(config);
  useLayoutEffect(() => {
    configRef.current = config;
  }, [config]);

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
      // Mapは挿入順を保つので、参照のたびに末尾へ入れ直すとLRUになる。
      // 挿入順のまま追い出すと、最初に入る静的ジオメトリ（フィールドライン等）から
      // 捨てられてしまい、キャッシュが最も効くエントリを優先的に失う。
      const cached = cache.get(primitive);
      cache.delete(primitive);
      cache.set(primitive, cached);
      return cached;
    }
    const cmd = parsePrimitiveCommand(primitive);
    if (cache.size >= PRIMITIVE_CACHE_MAX_ENTRIES) {
      const keys = Array.from(cache.keys()).slice(0, PRIMITIVE_CACHE_EVICT_COUNT);
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

  /**
   * シーンをキャンバスへ描画する。
   * 描画できなかった場合は再描画要求を残す
   * （消費したまま諦めると、次にフラグが立つまで画面が固着する）。
   */
  const drawCanvasScene = useCallback((displayMsg: SvgLayerArray | undefined) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      redrawNeededRef.current = true;
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      redrawNeededRef.current = true;
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // パネルが折りたたまれている等でサイズが0のときは描画せず、再描画要求を残しておく。
    // ここで描いてしまうと scale=0 の非可逆行列になって描画命令が黙って捨てられ、
    // 再描画フラグだけが消費されて画面が固着する。
    if (rect.width <= 0 || rect.height <= 0) {
      redrawNeededRef.current = true;
      return;
    }

    const vb = parseViewBox();
    const { scale, offsetX, offsetY } = getCanvasViewport(rect, vb);
    if (!(scale > 0)) {
      redrawNeededRef.current = true;
      return;
    }

    const desiredWidth = Math.max(1, Math.round(rect.width * dpr));
    const desiredHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
      canvas.width = desiredWidth;
      canvas.height = desiredHeight;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, rect.width, rect.height);
    ctx.clip();

    ctx.setTransform(
      scale * dpr,
      0,
      0,
      scale * dpr,
      (offsetX - vb.x * scale) * dpr,
      (offsetY - vb.y * scale) * dpr,
    );

    displayMsg?.svg_primitive_arrays.forEach((layerArray) => {
      // 未登録のレイヤーは既定で表示する。明示的に false のときだけ隠す。
      // （未登録＝非表示にすると、新規レイヤーが setConfig で登録されるまでの
      //   1コミット分だけ描画から抜け落ちてちらつく）
      if (config.namespaces[layerArray.layer]?.visible === false) return;
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
    config.grsimEnabled,
    config.namespaces,
    cursorSvgPos,
    drawPrimitive,
    getOrParsePrimitive,
    getCanvasViewport,
    grsimMode,
    parseViewBox,
  ]);

  // 表示に影響する状態が変わったら再描画を要求する。
  // メッセージ受信による要求は onRender 側で直接立てる。
  useEffect(() => {
    redrawNeededRef.current = true;
  }, [
    viewBox,
    config.backgroundColor,
    config.enableUpdateTopic,
    config.grsimEnabled,
    config.namespaces,
    cursorSvgPos,
    grsimMode,
  ]);

  const resetViewBox = useCallback(() => {
    const x = -config.viewBoxWidth / 2;
    const aspectRatio = 0.6; // 元のアスペクト比 (6000 / 10000)
    const height = config.viewBoxWidth * aspectRatio;
    const y = -height / 2;
    setViewBox(`${x} ${y} ${config.viewBoxWidth} ${height}`);
  }, [setViewBox, config]);

  // 指定した再生時刻の表示内容を合成する
  //
  // 「その時刻以前で最新のスナップショット」を土台に、「そのスナップショットより後、かつ
  // 指定時刻以前」の更新を時刻順に適用する。履歴はts昇順に並んでいるので、
  // 適用範囲は二分探索で切り出せる（全走査しない）。
  const composeMessagesAtTime = useCallback((targetTime: number): SvgLayerArray | undefined => {
    try {
      const snapshots = aggregatedHistoryRef.current;
      const updates = updateHistoryRef.current;

      const snapshotIndex = lastIndexAtOrBefore(snapshots, targetTime);
      const snapshot = snapshotIndex >= 0 ? snapshots[snapshotIndex] : undefined;

      // ベースとなるレイヤーデータ。
      // メッセージは不変なので、プリミティブ配列は複製せず参照のまま保持する
      // （複製が要るのは append のときだけ）。
      const layerMap = new Map<string, readonly string[]>();
      if (snapshot) {
        for (const array of snapshot.msg.svg_primitive_arrays) {
          layerMap.set(array.layer, array.svg_primitives);
        }
      }

      if (configRef.current.enableUpdateTopic) {
        // スナップショットが無い場合は履歴の最古から、ある場合はその直後から適用する
        const startIndex = snapshot ? lastIndexAtOrBefore(updates, snapshot.ts) + 1 : 0;
        const endIndex = lastIndexAtOrBefore(updates, targetTime);

        for (let i = startIndex; i <= endIndex; i++) {
          const entry = updates[i];
          if (!entry) continue;

          for (const update of entry.msg.updates) {
            if (!update || !update.layer || !update.operation) continue;

            switch (update.operation) {
              case "replace":
                if (Array.isArray(update.svg_primitives)) {
                  layerMap.set(update.layer, update.svg_primitives);
                }
                break;
              case "append":
                // 土台となるスナップショットが無いと append の結果は正しくないので適用しない
                if (snapshot && Array.isArray(update.svg_primitives)) {
                  const current = layerMap.get(update.layer) ?? EMPTY_PRIMITIVES;
                  layerMap.set(update.layer, [...current, ...update.svg_primitives]);
                }
                break;
              case "clear":
                // ベースが無くても clear 自体は適用できる（結果は空レイヤー）
                layerMap.set(update.layer, EMPTY_PRIMITIVES);
                break;
              default:
                console.warn(`Unknown operation: ${update.operation}`);
                break;
            }
          }
        }
      }

      // 空のレイヤーは結果から除外する
      const arrays: SvgPrimitiveArray[] = [];
      layerMap.forEach((primitives, layer) => {
        if (primitives.length > 0) {
          // 以降は読み取り専用にしか使わないため、readonly を外して渡す
          arrays.push({ layer, svg_primitives: primitives as string[] });
        }
      });

      if (!snapshot && arrays.length === 0) {
        return undefined; // この時刻に表示できるデータが履歴に無い
      }
      return { svg_primitive_arrays: arrays };
    } catch (error) {
      console.error('Error in composeMessagesAtTime:', error);
      return undefined;
    }
  }, []);

  // 履歴クリーンアップ関数
  //
  // カットオフは必ず「再生時刻(bag時刻)」を基準にする。
  // 履歴Mapのキーは message.receiveTime（＝データソース由来の収録時刻）であり、
  // 壁時計 Date.now() とは別の時間軸である。rosbag再生では両者が何時間も乖離するため、
  // Date.now()を基準にすると全メッセージが一括で切り捨てられ、
  // 「表示が巻き戻る」「レイヤーが消える」という症状を周期的に引き起こす。
  const cleanupHistory = useCallback(() => {
    const anchorTime = seekTimeRef.current ?? latestReceivedTsRef.current;
    if (anchorTime === undefined) return; // 基準時刻が定まらないうちは何も捨てない

    const { maxHistoryDuration, maxHistorySize } = configRef.current;
    const cutoffTime = anchorTime - maxHistoryDuration * 1000;
    const snapshots = aggregatedHistoryRef.current;
    const updates = updateHistoryRef.current;

    // 現在の再生時刻で土台に使われるスナップショットと、それ以降の更新は絶対に捨てない。
    // 土台を失うと合成が「スナップショット無し」に落ちて append が全滅し、
    // 土台以降の更新を失うと表示がスナップショット時点まで巻き戻る。
    // （maxHistoryDuration がスナップショット周期より短く設定された場合の保険）
    const activeSnapshot = snapshots[lastIndexAtOrBefore(snapshots, anchorTime)];
    const safeCutoff = activeSnapshot ? Math.min(cutoffTime, activeSnapshot.ts) : cutoffTime;

    dropHistoryBefore(snapshots, safeCutoff);
    dropHistoryBefore(updates, safeCutoff);

    // 件数上限。スナップショットには maxHistorySize を効かせるが、更新には時間窓しか
    // 効かせない（更新は数百Hzで届くため件数で切ると最新スナップショット以降に穴が空く）。
    // UPDATE_HISTORY_HARD_CAP は異常時の安全弁であり、通常運用では発動しない。
    // どちらの上限も、土台のスナップショットとそれ以降は削らない。
    dropOldestKeepingActive(snapshots, maxHistorySize, activeSnapshot?.ts);
    dropOldestKeepingActive(updates, UPDATE_HISTORY_HARD_CAP, activeSnapshot?.ts);

    redrawNeededRef.current = true;
  }, []);

  // 定期的なクリーンアップ
  useEffect(() => {
    const interval = setInterval(() => {
      cleanupHistory();
    }, 5000); // 保持期間が短いので短い周期で回す

    return () => clearInterval(interval);
  }, [cleanupHistory]);

  // 新しく現れたレイヤーを namespaces に登録する（設定UIの表示制御に出すため）。
  //
  // 新規が無ければ config を作り直さない。作り直すと config の identity が毎フレーム変わり、
  // saveState・設定ツリーの再構築・各種 effect が毎フレーム走ってしまう。
  const registerLayers = useCallback((composed: SvgLayerArray | undefined) => {
    if (!composed) return;

    let hasNewLayer = false;
    for (const array of composed.svg_primitive_arrays) {
      if (!knownLayersRef.current.has(array.layer)) {
        knownLayersRef.current.add(array.layer);
        hasNewLayer = true;
      }
    }
    if (!hasNewLayer) return;

    setConfig((prevConfig) => {
      const newNamespaces = { ...prevConfig.namespaces };
      let changed = false;
      knownLayersRef.current.forEach((layer) => {
        if (!newNamespaces[layer]) {
          newNamespaces[layer] = { visible: true };
          changed = true;
        }
      });
      return changed ? { ...prevConfig, namespaces: newNamespaces } : prevConfig;
    });
  }, []);

  // drawCanvasScene は config や viewBox に依存して作り直されるため、
  // rAFループを貼り替えずに最新版を呼べるよう ref 経由にする。
  // （毎コミットで cancelAnimationFrame → requestAnimationFrame を繰り返すと、
  //   コールバックが発火する前に取り消され続けて描画が飢餓状態になりうる）
  const drawSceneRef = useRef(drawCanvasScene);
  useLayoutEffect(() => {
    drawSceneRef.current = drawCanvasScene;
  }, [drawCanvasScene]);

  // 合成と描画を requestAnimationFrame ループ1本に集約する。
  // 受信(onRender) → 再描画要求 → 次フレームで合成・描画 → done() 返却、という一方向の流れ。
  // composeMessagesAtTime と registerLayers は useCallback([]) で安定なのでループは貼り替わらない。
  useEffect(() => {
    let rafId = 0;
    const loop = () => {
      if (redrawNeededRef.current) {
        redrawNeededRef.current = false;
        const targetTime = seekTimeRef.current ?? latestReceivedTsRef.current;
        const composed = targetTime === undefined ? undefined : composeMessagesAtTime(targetTime);
        drawSceneRef.current(composed);
        registerLayers(composed);
      }

      // done は描画を終えてから返す。プレイヤーはこれを次フレーム送出の合図に使うため、
      // 描画前に返すと再生がパネルを追い越す。
      // 1フレームの間に複数の onRender が届くことがあるので、溜まっている分をすべて呼ぶ
      // （最新のものだけ呼ぶとプレイヤーが停止する）。
      //
      // 描画をスキップしたフレームでも必ず返すこと。Foxglove は全パネルの done を待って
      // 再生を進めるため、返さないとレイアウト全体の再生が止まり、このパネルが
      // 再表示されるまで復帰しない（畳まれた・タブで隠れたパネルは日常的な状態）。
      // スキップした再描画要求は redrawNeededRef に残るので取りこぼしはない。
      if (pendingDonesRef.current.length > 0) {
        const dones = pendingDonesRef.current;
        pendingDonesRef.current = [];
        for (const done of dones) {
          done();
        }
      }

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      // 未返却の done を残したままにするとプレイヤーが待ち続けるので解放する
      const dones = pendingDonesRef.current;
      pendingDonesRef.current = [];
      for (const done of dones) {
        done();
      }
    };
  }, [composeMessagesAtTime, registerLayers]);

  // キャンバスのリサイズ検知。
  // サイズ変化は描画中のインライン判定だけでは拾えない（描画が走らないと到達しない）ため、
  // ResizeObserver で明示的に再描画を要求する。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      redrawNeededRef.current = true;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

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
      setConfig((prevConfig) => ({
        ...prevConfig,
        ...savedConfig,
        // 旧バージョンが保存した過大な値をそのまま使うとメモリと履歴整合を壊すため丸める
        maxHistoryDuration: clampHistoryDuration(savedConfig.maxHistoryDuration),
        namespaces: savedConfig.namespaces || prevConfig.namespaces,
      }));
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
                help: `再生時刻からこの秒数より古いメッセージを削除（${MIN_HISTORY_DURATION_SEC}〜${MAX_HISTORY_DURATION_SEC}秒に丸められます）`,
              },
              maxHistorySize: {
                label: "最大スナップショット数",
                input: "number",
                value: config.maxHistorySize,
                help: "保持するスナップショットの最大数（更新トピックには適用されない）"
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
                setConfig((prevConfig) => ({ ...prevConfig, maxHistoryDuration: clampHistoryDuration(action.payload.value as number) }));
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
                // path は配列のまま扱う。join(".") した文字列を split すると
                // レイヤー名に "." が含まれる場合に経路が壊れる。
                const layer = action.payload.path[1];
                if (layer !== undefined) {
                  const visible = action.payload.value as boolean;
                  // config.namespaces を直接書き換えると再レンダーも再描画も saveState も
                  // 走らないため、必ず setConfig で不変更新する。
                  setConfig((prevConfig) => {
                    const namespaces = setNamespaceVisible(prevConfig.namespaces, layer, visible);
                    return namespaces === prevConfig.namespaces
                      ? prevConfig
                      : { ...prevConfig, namespaces };
                  });
                }
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

  // フィールドキーはレイヤー名そのもの。actionHandler 側は action.payload.path[1] を
  // そのままキーとして使うため、両者は必ず一致させること。
  // （以前は子ノードを "親.子" というキーへ平坦化していたが、レイヤー名に "." を含むと
  //   パスを復元できず、そもそも children を生成するコードが存在しなかった）
  const createNamespaceFields = (namespaces: NamespaceTree) => {
    const fields: { [key: string]: SettingsTreeField } = {};
    for (const [name, node] of Object.entries(namespaces)) {
      fields[name] = {
        label: name,
        input: "boolean",
        value: node.visible,
        help: "名前空間の表示/非表示",
      };
    }
    return fields;
  };


  // メッセージ受信時の処理
  //
  // 履歴への取り込みはここで同期的に完了させる。React の state を経由すると
  // 受信から合成までにコミット1回分の遅延が入り、その間は
  // 「新しい再生時刻 × 古い更新集合」で合成された絵＝巻き戻った表示になる。
  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      // 1. 再生時刻の更新とシーク検出（このフレームの取り込みより前に行う）
      if (renderState.currentTime !== undefined) {
        const newCurrentTime =
          renderState.currentTime.sec * 1000 + renderState.currentTime.nsec / 1000000;
        const previousTime = seekTimeRef.current;
        // didSeek はデータソースがメッセージを取りこぼしたことを示す。
        // 再生時刻の巻き戻り（ループ再生・後方シーク）も同じ扱いにする。
        const seeked =
          renderState.didSeek === true ||
          (previousTime !== undefined && newCurrentTime < previousTime);

        seekTimeRef.current = newCurrentTime;

        if (seeked) {
          // 移動先以降の履歴は、これから同じメッセージが配信され直すので捨てる。
          // 残すと同一メッセージが二重に積まれ、履歴が再生のたびに膨らむ。
          truncateHistoryFrom(aggregatedHistoryRef.current, newCurrentTime);
          truncateHistoryFrom(updateHistoryRef.current, newCurrentTime);
        }
      }

      // 2. このフレームのメッセージを履歴へ取り込む
      const { aggregatedTopic, updateTopic, enableUpdateTopic, refereeTopic, enableScoreboard } =
        configRef.current;

      for (const message of renderState.currentFrame ?? []) {
        const timestamp = message.receiveTime.sec * 1000 + message.receiveTime.nsec / 1000000;
        if (latestReceivedTsRef.current === undefined || timestamp > latestReceivedTsRef.current) {
          latestReceivedTsRef.current = timestamp;
        }

        if (message.topic === aggregatedTopic) {
          const snapshot = normalizeSnapshot(message.message);
          if (snapshot) {
            pushHistoryEntry(aggregatedHistoryRef.current, { ts: timestamp, msg: snapshot });
          }
        } else if (enableUpdateTopic && message.topic === updateTopic) {
          const updates = normalizeUpdates(message.message);
          if (updates) {
            pushHistoryEntry(updateHistoryRef.current, { ts: timestamp, msg: updates });
          }
        } else if (enableScoreboard && message.topic === refereeTopic) {
          setRefereeData(message.message as unknown as RefereeMessage);
        }
      }

      // 3. 次のフレームで合成・描画する
      redrawNeededRef.current = true;

      // 4. done は描画を終えてから返す（rAFループ側で呼ぶ）
      pendingDonesRef.current.push(done);
    };

    context.watch("currentFrame");
    context.watch("currentTime");
    context.watch("didSeek");

  }, [context]);

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
