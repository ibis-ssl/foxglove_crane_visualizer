import * as React from "react";
import { useCallback, useLayoutEffect, useState, useEffect, useMemo } from "react";
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
    {layer.primitives.map((primitive, index) => (
      <g
        key={index}
        dangerouslySetInnerHTML={{ __html: primitive.svg_text }}
      />
    ))}
    {/* 子レイヤーの再帰描画 */}
    {Object.values(layer.children).map((child) => renderLayer(child))}
  </g>
);

const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [viewBox, setViewBox] = useState("-5000 -3000 5000 3000");
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);
  const [topic, setTopic] = useState<string>("/visualizer_svgs");
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [recv_num, setRecvNum] = useState(0);

  const [layerTree, setLayerTree] = useState<Record<string, Layer>>({});
  const handleSvgPrimitiveArray = (data: SvgPrimitiveArray) => {
    const path = data.layer.split("/").filter((part) => part);
    setRecvNum((prevNum) => prevNum + 1);
    setLayerTree((prevTree) =>
      updateLayerTree(prevTree, path, data.primitives)
    );
  };

  // トピックが設定されたときにサブスクライブする
  useEffect(() => {
    const subscription: Subscription = { topic: topic };
    context.subscribe([subscription]);
  }, [topic]);

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
              topic: { label: "トピック名", input: "string", value: topic },
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
              if (path == "general.topic") {
                setTopic(action.payload.value as string);
              } else if (path == "general.showGrid") {
                setConfig((prevConfig) => ({ ...prevConfig, showGrid: action.payload.value as boolean }));
              } else if (path == "general.backgroundColor") {
                setConfig((prevConfig) => ({ ...prevConfig, backgroundColor: action.payload.value as string }));
              } else if (path == "general.fieldColor") {
                setConfig((prevConfig) => ({ ...prevConfig, fieldColor: action.payload.value as string }));
              } else if (action.payload.path[0] == "namespaces") {
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


  // メッセージ受信時の処理
  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setMessages(renderState.currentFrame);
      setTopics(renderState.topics);
    };

    context.watch("topics");
    context.watch("currentFrame");

  }, [context]);

  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        if (message.topic === topic) {
          handleSvgPrimitiveArray(message.message as SvgPrimitiveArray);
        }
      }
    }
  }, [messages]);

  // invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <div>
        <p>Topic: {topic}</p>
      </div>
      <div>
        <p>Receive num: {recv_num}</p>
      </div>
      {Object.values(layerTree).map((layer) => (
        <div key={layer.name}>
          <p>{layer.name} : {layer.primitives.length}</p>
          {/* {Object.values(layer.children).map((child: Layer) => (
            <>
              <p key={child.name}>{child.name} : {child.primitives?.length || 0}</p>
              {child.primitives?.map((primitive: SvgPrimitive, index) => (
                <p>{primitive.svg_text}</p>
              ))}
            </>
          ))} */}
        </div>
      ))}
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        style={{ backgroundColor: config.backgroundColor }}
        onMouseDown={(e) => {
          const startX = e.clientX;
          const startY = e.clientY;
          const [x, y, width, height] = viewBox.split(" ").map(Number);
          const initialWidth = 10000;
          const initialHeight = 6000;
          const handleMouseMove = (e: MouseEvent) => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const scaledDx = dx / initialWidth * 1000;
            const scaledDy = dy / initialHeight * 1000;
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
