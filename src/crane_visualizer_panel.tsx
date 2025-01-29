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

interface SvgPrimitiveArray {
  layer: string; // "parent/child1/child2"のような階層パス
  svg_primitives: string[];
}

interface SvgLayerArray{
  svg_primitive_arrays: SvgPrimitiveArray[];
}

interface PanelConfig {
  backgroundColor: string;
  fieldColor: string;
  message: string;
  namespaces: {
    [key: string]: {
      visible: boolean;
      children?: { [key: string]: { visible: boolean; children?: any } };
    };
  };
}

const defaultConfig: PanelConfig = {
  backgroundColor: "#FFFFFF",
  fieldColor: "#00FF00",
  message: "",
  namespaces: {},
};


const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [viewBox, setViewBox] = useState("-5000 -3000 5000 3000");
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);
  const [topic, setTopic] = useState<string>("/aggregated_svgs");
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>();
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>();
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [recv_num, setRecvNum] = useState(0);
  const [latest_msg, setLatestMsg] = useState<SvgLayerArray>();

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
          setLatestMsg(message.message as SvgLayerArray);
          setRecvNum(recv_num + 1);
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
            const scaledDx = dx * width / 400;
            const scaledDy = dy * height / 400;
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
          const scale = e.deltaY > 0 ? 0.8 : 1.2;
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
        {latest_msg && latest_msg.svg_primitive_arrays.map((svg_primitive_array, index) => (
          <g key={svg_primitive_array.layer}>
            {svg_primitive_array.svg_primitives.map((svg_primitive, index) => (
              <g dangerouslySetInnerHTML= {{ __html: svg_primitive }} />
            ))}
          </g>
        ))}
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
