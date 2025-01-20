import * as React from "react";
import { useCallback, useLayoutEffect, useState, useEffect, useMemo } from "react";
import {
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeField,
  MessageEvent,
  Topic,
  Immutable
} from "@foxglove/studio";
import ReactDOM from "react-dom";
import { StrictMode } from "react";

interface SvgPrimitive {
  id: number;
  lifetime: number;
  svg_text: string; // SVG要素を表すテキスト
}

interface SvgPrimitiveArray {
  layer: string; // "parent/child1/child2"のような階層パス
  primitives: SvgPrimitive[];
}

interface PanelConfig {
  topic: string;
  backgroundColor: string;
  fieldColor: string;
  showGrid: boolean;
  gridSize: number;
  message: string;
  namespaces: {
    [key: string]: {
      visible: boolean;
      children?: { [key: string]: { visible: boolean; children?: any } };
    };
  };
}

type MessageHandler = (event: MessageEvent) => void;

const defaultConfig: PanelConfig = {
  topic: "/visualizer_svgs",
  backgroundColor: "#FFFFFF",
  fieldColor: "#00FF00",
  showGrid: true,
  gridSize: 100,
  message: "",
  namespaces: {},
};

interface Layer {
  name: string; // レイヤー名
  primitives: SvgPrimitive[]; // SVGプリミティブ
  children: Record<string, Layer>; // 子レイヤー
}

const parseLayerPath = (path: string): string[] => path.split("/");

const updateLayerTree = (
  tree: Record<string, Layer>,
  path: string[],
  newLayer: SvgPrimitive[]
): Record<string, Layer> => {
  if (path.length === 0) return tree;

  const [current, ...rest] = path;
  if (rest.length === 0) {
    // 末端のレイヤーを上書き
    return {
      ...tree,
      [current]: {
        name: current,
        primitives: newLayer,
        children: {},
      },
    };
  }

  return {
    ...tree,
    [current]: {
      name: current,
      primitives: tree[current]?.primitives || [],
      children: updateLayerTree(tree[current]?.children || {}, rest, newLayer),
    },
  };
};

const renderLayer = (layer: Layer): React.ReactNode => (
  <g key={layer.name}>
    {/* SVGプリミティブの描画 */}
    {layer.primitives.map((primitive) => (
      <g
        key={primitive.id}
        dangerouslySetInnerHTML={{ __html: primitive.svg_text }}
      />
    ))}
    {/* 子レイヤーの再帰描画 */}
    {Object.values(layer.children).map((child) => renderLayer(child))}
  </g>
);

const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [primitives, setPrimitives] = useState<Map<number, SvgPrimitive & { expiryTime: number }>>(
    new Map()
  );
  const [viewBox, setViewBox] = useState("-450 -300 900 600");
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();

  const [svgArrayMessage, setSvgArrayMessage] = useState<SvgPrimitiveArray | undefined>();

  const [layerTree, setLayerTree] = useState<Record<string, Layer>>({});
  const handleSvgPrimitiveArray = (data: SvgPrimitiveArray) => {
    const path = parseLayerPath(data.layer);
    setLayerTree((prevTree) =>
      updateLayerTree(prevTree, path, data.primitives)
    );
  };

  const svgTopics = useMemo(
    () => (topics ?? []).filter((topic) => topic.schemaName === "crane_visualization_interfaces/msg/SvgPrimitiveArray"),
    [topics],
  );

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
          general: {
            label: "General",
            fields: {
              topic: { label: "トピック名", input: "string", value: config.topic },
              showGrid: { label: "グリッド表示", input: "boolean", value: config.showGrid },
              backgroundColor: { label: "背景色", input: "rgba", value: config.backgroundColor },
              fieldColor: { label: "フィールド色", input: "rgba", value: config.fieldColor },
            },
          },
          namespaces: {
            label: "名前空間",
            fields: createNamespaceFields(config.namespaces),
          },
        },
        actionHandler: (action: SettingsTreeAction) => {
          const path = action.payload.path.join(".");
          switch (action.action) {
            case "update":
              setConfig((prevConfig) => {
                const newConfig = { ...prevConfig };
                const pathParts = path.split(".");
                const namespacePath = pathParts.slice(1, -1);
                const leafNamespace = pathParts[pathParts.length - 1];
                let currentNs = newConfig.namespaces;
                for (const ns of namespacePath) {
                  currentNs = currentNs[ns].children || {};
                }
                currentNs[leafNamespace].visible = action.payload.value as boolean;
                return newConfig;
              });
              break;
            case "perform-node-action":
              break;
          }
        },
      };
      context.updatePanelSettingsEditor(panelSettings);
    };

    updatePanelSettings();
    let unsubscribe;
      const handleMessage: MessageHandler = (event: MessageEvent) => {
        if (typeof event.message === 'object' && event.message !== null && 'primitives' in event.message) {
          handleSvgPrimitiveArray(event.message as SvgPrimitiveArray);
        }
      };
    unsubscribe = context.subscribe([{ topic: config.topic }]);
    return () => {
      // unsubscribe は void を返す可能性があるため、この行は削除します。
    };
  }, [context, config, setConfig, setPrimitives]);

  const renderGrid = useCallback(() => {
    if (!config.showGrid) return null;
    const lines: JSX.Element[] = [];
    const size = config.gridSize;
    for (let x = -450; x <= 450; x += size) {
      lines.push(
        <line
          key={`vertical-${x}`}
          x1={x}
          y1={-300}
          x2={x}
          y2={300}
          stroke="#CCCCCC"
          strokeWidth="1"
          opacity="0.5"
        />
      );
    }
    for (let y = -300; y <= 300; y += size) {
      lines.push(
        <line
          key={`horizontal-${y}`}
          x1={-450}
          y1={y}
          x2={450}
          y2={y}
          stroke="#CCCCCC"
          strokeWidth="1"
          opacity="0.5"
        />
      );
    }
    return lines;
  }, [config.showGrid, config.gridSize]);

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


    useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setMessages(renderState.currentFrame);
      setTopics(renderState.topics);
    };

    context.watch("topics");
    context.watch("currentFrame");

  }, [context]);

  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        if (message.topic === config.topic) {
          setSvgArrayMessage(message.message as SvgPrimitiveArray);
          // setLogMessages((prevMessages) => [...prevMessages, `Received message on topic '${message.topic}'`]);
          setPrimitives((prevPrimitives) => {
            const now = Date.now();
            const updatedPrimitives = new Map(prevPrimitives);
            for (const [id, primitive] of prevPrimitives) {
              if (primitive.expiryTime <= now) {
                updatedPrimitives.delete(id);
              }
            }
            return updatedPrimitives;
          });
        }
      }
    }
  }, [messages]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <div>
        <p>Topic: {config.topic}</p>
      </div>
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        style={{ backgroundColor: config.backgroundColor }}
        onMouseDown={(e) => {
          const startX = e.clientX;
          const startY = e.clientY;
          const [x, y, width, height] = viewBox.split(" ").map(Number);
          const handleMouseMove = (e: MouseEvent) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            setViewBox(`${x - dx} ${y - dy} ${width} ${height}`);
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
          const scale = e.deltaY > 0 ? 0.9 : 1.1;
          const newWidth = width * scale;
          const newHeight = height * scale;
          const centerX = x + width / 2;
          const centerY = y + height / 2;
          const newX = centerX - newWidth / 2;
          const newY = centerY - newHeight / 2;
          setViewBox(`${newX} ${newY} ${newWidth} ${newHeight}`);
        }}
      >
        {config.showGrid && renderGrid()}
        {Object.values(layerTree).map((layer) => renderLayer(layer))}
      </svg>
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
