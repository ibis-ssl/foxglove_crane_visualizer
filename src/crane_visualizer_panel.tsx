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
  namespaces: {},
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
    context.subscribe(subscriptions);
  }, [config.aggregatedTopic, config.updateTopic, config.enableUpdateTopic]);

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
        }
      }
    }
  }, [messages, config.aggregatedTopic, config.updateTopic, config.enableUpdateTopic]);

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
      <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        <div>
          <p>Aggregated Topic: {config.aggregatedTopic}</p>
          {config.enableUpdateTopic && <p>Update Topic: {config.updateTopic}</p>}
        </div>
        <div>
          <p>Receive num: {recv_num}</p>
          <p>History: Aggregated({aggregatedMessages.size}), Updates({updateMessages.size})</p>
          {seekTime !== undefined && <p>Seek Time: {new Date(seekTime).toISOString()}</p>}
        </div>
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
