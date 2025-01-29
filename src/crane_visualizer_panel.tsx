import * as React from "react";
import { useCallback, useLayoutEffect, useState, useEffect, useRef } from "react";
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

interface PanelConfig {
  backgroundColor: string;
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
  backgroundColor: "#b0b0b0ff",
  message: "",
  namespaces: {},
};

interface Layer {
  name: string; // レイヤー名
  primitives: string[]; // SVGプリミティブ
  children: Record<string, Layer>; // 子レイヤー
}

const updateLayerTree = (
  tree: Record<string, Layer>,
  path: string[],
  newLayer: string[]
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

interface SvgRendererProps {
  svgData: string;
  visibleLayers: string[];
}

const SvgRenderer: React.FC<SvgRendererProps> = ({ svgData, visibleLayers }) => {
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [viewBox, setViewBox] = useState({ x: -5000, y: -3000, width: 5000, height: 3000 });

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      setIsDragging(true);
      setDragStart({ x: event.clientX, y: event.clientY });
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging && dragStart && svgContainerRef.current) {
        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;
        setViewBox((prev) => ({
          x: prev.x - dx,
          y: prev.y - dy,
          width: prev.width,
          height: prev.height,
        }));
        setDragStart({ x: event.clientX, y: event.clientY });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragStart(null);
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaY < 0 ? 0.9 : 1.1;
      setViewBox((prev) => ({
        x: prev.x + (prev.width * (1 - scale)) / 2,
        y: prev.y + (prev.height * (1 - scale)) / 2,
        width: prev.width * scale,
        height: prev.height * scale,
      }));
    };

    const container = svgContainerRef.current as HTMLDivElement;
    if (container) {
      container.addEventListener("mousedown", handleMouseDown);
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseup", handleMouseUp);
      container.addEventListener("wheel", handleWheel);

      return () => {
        container.removeEventListener("mousedown", handleMouseDown);
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseup", handleMouseUp);
        container.removeEventListener("wheel", handleWheel);
      };
    }

if (svgContainerRef.current && svgData) {
  const container = svgContainerRef.current;
  if (container) {
    container.innerHTML = svgData;
    const svgElement = container.querySelector("svg");
    if (svgElement) {
      svgElement.setAttribute("width", "100%");
      svgElement.setAttribute("height", "100%");
      svgElement.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    }
  }
}
  }, [svgData, visibleLayers, viewBox, isDragging, dragStart]);

  return <div ref={svgContainerRef} style={{ width: "100%", height: "100%" }} />;
};

const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);
  const [topic, setTopic] = useState<string>("/aggregated_svgs");const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [recv_num, setRecvNum] = useState(0);

  const [svgData, setSvgData] = useState<string>("");
  const [testData, setTestData] = useState<string>("");

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
              backgroundColor: { label: "背景色", input: "rgba", value: config.backgroundColor },
            },
          },
        },
        actionHandler: (action: SettingsTreeAction) => {
          const path = action.payload.path.join(".");
          switch (action.action) {
            case "update":
              if (path == "general.topic") {
                setTopic(action.payload.value as string);
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

  // メッセージ受信時の処理
  useLayoutEffect(() => {
    context.onRender = (renderState, done) => {
      setRenderDone(() => done);
      setMessages(renderState.currentFrame);
    };
    context.watch("currentFrame");

  }, [context]);

  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        if (message.topic === topic) {
          setSvgData((message.message as { data: string }).data);
          setRecvNum((prevNum) => prevNum + 1);
        }
      }
    }
  }, [messages]);

  // invoke the done callback once the render is complete
  useEffect(() => {
    renderDone?.();
  }, [renderDone]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", backgroundColor: config.backgroundColor }}>
      <div>
        <p>Topic: {topic}</p>
      </div>
      <div>
        <p>Receive num: {recv_num}</p>
      </div>
      <div>
        <p>{svgData}</p>
      </div>
      <SvgRenderer svgData={svgData} visibleLayers={[]} />
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
