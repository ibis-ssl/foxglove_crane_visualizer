import * as React from "react";
import { useCallback, useLayoutEffect, useState, useEffect } from "react";
import {
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeField,
} from "@foxglove/studio";
import ReactDOM from "react-dom";
import { StrictMode } from "react";

interface SvgPrimitive {
  id: number;
  lifetime: number;
  svg_text: string;
  primitive_namespace: string;
}

interface SvgPrimitiveArray {
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

type MessageEvent = {
  message: unknown;
  topic: string;
  receiveTime: { sec: number; nsec: number };
};

type MessageHandler = (event: MessageEvent) => void;

const defaultConfig: PanelConfig = {
  topic: "/visualization/primitives",
  backgroundColor: "#FFFFFF",
  fieldColor: "#00FF00",
  showGrid: true,
  gridSize: 100,
  message: "",
  namespaces: {
  },
};

// const createTestData = (time: number, namespaces: PanelConfig["namespaces"]) => {
//   const t = time * 0.001;
//   const primitives: SvgPrimitive[] = [];
//   const addPrimitives = (ns: PanelConfig["namespaces"], path: string[] = []) => {
//     for (const [name, { visible, children }] of Object.entries(ns)) {
//       if (!visible) continue;
//       const namespace = path.concat(name).join(".");
//       const subNamespace = children ? Object.keys(children)[0] : undefined;
//       // Primitive の代わりに SvgPrimitive を生成
//       primitives.push({
//         id: primitives.length + 1,
//         lifetime: Math.random() * 1,
//         svg_text: `<circle cx="${Math.random() * 1000 - 500}" cy="${Math.random() * 600 - 300}" r="${Math.random() * 100}" fill="rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.5)" />`,
//         primitive_namespace: namespace,
//       });
//       if (children) {
//         addPrimitives(children, path.concat(name));
//       }
//     }
//   };
//   addPrimitives(namespaces);
//   return primitives;
// };

const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [primitives, setPrimitives] = useState<Map<number, SvgPrimitive & { expiryTime: number }>>(
    new Map()
  );
  const [viewBox, setViewBox] = useState("-450 -300 900 600");
  const [config, setConfig] = useState<PanelConfig>(defaultConfig);

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
    const handleMessage: MessageHandler = (event: MessageEvent) => {
      const primitiveMsg = event.message as SvgPrimitiveArray;
      const now = Date.now();
      setPrimitives((prevPrimitives) => {
        const updatedPrimitives = new Map(prevPrimitives);
        primitiveMsg.primitives.forEach((primitive: SvgPrimitive) => {
          const namespacePath = primitive.primitive_namespace.split("/");
          let currentNs = config.namespaces;
          let visible = true;
          for (const ns of namespacePath) {
            if (!currentNs[ns] || !currentNs[ns].visible) {
              visible = false;
              break;
            }
            currentNs = currentNs[ns].children || {};
          }
          if (visible && !prevPrimitives.has(primitive.id)) {
            const newConfig = { ...config };
            let currentNs = newConfig.namespaces;
            for (let i = 0; i < namespacePath.length - 1; i++) {
              currentNs = currentNs[namespacePath[i]].children!;
            }
            currentNs[namespacePath[namespacePath.length - 1]].visible = true;
            setConfig(newConfig);
          }
          updatedPrimitives.set(primitive.id, {
            ...primitive,
            expiryTime: primitive.lifetime > 0 ? now + primitive.lifetime * 1000 : Infinity,
          });
        });
        return updatedPrimitives;
      });
    };
    const unsubscribe = context.subscribe([{ topic: config.topic }]);
    return unsubscribe;
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

  const renderPrimitive = useCallback(
    (primitive: SvgPrimitive & { expiryTime: number } | null): JSX.Element | null => {
      if (!primitive) return null;
      const { id, svg_text } = primitive;
      return <g key={id} dangerouslySetInnerHTML={{ __html: svg_text }} />;
    },
    []
  );

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

  const shouldRenderPrimitive = (primitive: SvgPrimitive & { expiryTime: number }) => {
    const namespacePath = primitive.primitive_namespace.split("/");
    let visible = true;
    let currentNs = config.namespaces;
    for (const ns of namespacePath) {
      if (!currentNs[ns] || !currentNs[ns].visible) {
        visible = false;
        break;
      }
      currentNs = currentNs[ns].children || {};
    }
    return visible;
  };

  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();
      setPrimitives((prevPrimitives) => {
        const updatedPrimitives = new Map(prevPrimitives);
        for (const [id, primitive] of prevPrimitives) {
          if (primitive.expiryTime <= now) {
            updatedPrimitives.delete(id);
          }
        }
        return updatedPrimitives;
      });
    }, 100);
    return () => clearInterval(intervalId);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
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
        {Array.from(primitives.entries()).filter(([k, v]) => shouldRenderPrimitive(v)).map(([k, v]) =>
          renderPrimitive(v)
        )}
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
