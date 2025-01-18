import * as React from "react";
import { useCallback, useLayoutEffect, useState, useEffect } from "react";
import {
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeNode,
  SettingsTreeNodes,
  SettingsTreeAction,
  SettingsTreeField,
} from "@foxglove/studio";
import ReactDOM from "react-dom";
import { StrictMode } from "react";

interface Primitive {
  id: number;
  type: number;
  lifetime: number;
  params: number[];
  color: string;
  text?: string;
  namespace?: string;
  sub_namespace?: string;
}

interface PrimitiveArray {
  header: {
    stamp: { sec: number; nsec: number };
    frame_id: string;
  };
  primitives: Primitive[];
}

interface PanelConfig {
  topic: string;
  backgroundColor: string;
  fieldColor: string;
  showGrid: boolean;
  gridSize: number;
  testMode: boolean;
  testSpeed: number;
  message: string;
  namespaces: { [key: string]: boolean };
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
  testMode: true,
  testSpeed: 1,
  message: "",
  namespaces: {},
};

const createTestData = (time: number): Primitive[] => {
  const t = time * 0.001;
  return [
    {
      id: 1,
      type: 2,
      lifetime: 0,
      params: [-450, -300, 900, 600],
      color: "rgba(255, 0, 0, 0.5)",
      text: "sduhdsasjhsdkjfdhsjkfhk",
    },
    {
      id: 2,
      type: 0,
      lifetime: 0.1,
      params: [200 * Math.cos(t), 200 * Math.sin(t), 15],
      color: "rgba(0, 0, 255, 0.5)",
    },
  ];
};

const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [primitives, setPrimitives] = useState<Map<number, Primitive & { expiryTime: number }>>(
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
      setConfig(savedConfig);
    }
  }, [context, setConfig]);

  useEffect(() => {
    const panelSettings: SettingsTree = {
      nodes: {
        general: {
          label: "General",
          fields: {
            topic: { label: "トピック名", input: "string", value: config.topic },
            showGrid: { label: "グリッド表示", input: "boolean", value: config.showGrid },
            testMode: { label: "テストモード", input: "boolean", value: config.testMode },
            backgroundColor: { label: "背景色", input: "rgba", value: config.backgroundColor },
            fieldColor: { label: "フィールド色", input: "rgba", value: config.fieldColor },
          },
        },
        namespaces: {
          label: "名前空間",
          fields: Object.fromEntries(
            Object.entries(config.namespaces).map(([namespace, visible]) => [
              namespace as string,
              { label: namespace, input: "boolean", value: visible, help: "名前空間の表示/非表示" },
            ])
          ),
        },
      },
      actionHandler: (action: SettingsTreeAction) => {
        const path = action.payload.path.join(".");
        switch (action.action) {
          case "update":
            setConfig((prevConfig) => {
              switch (path) {
                case "general.showGrid":
                  return { ...prevConfig, showGrid: action.payload.value as boolean };
                case "general.testMode":
                  return { ...prevConfig, testMode: action.payload.value as boolean };
                case "general.backgroundColor":
                  return { ...prevConfig, backgroundColor: action.payload.value as string };
                case "general.fieldColor":
                  return { ...prevConfig, fieldColor: action.payload.value as string };
                default:
                  if (path.startsWith("namespaces.")) {
                    const [namespace] = path.split(".").slice(1);
                    return {
                      ...prevConfig,
                      namespaces: {
                        ...prevConfig.namespaces,
                        [namespace]: action.payload.value as boolean,
                      },
                    };
                  }
                  return prevConfig;
              }
            });
            break;
          case "perform-node-action":
            break;
        }
      },
    };
    context.updatePanelSettingsEditor(panelSettings);
  }, [context, config, setConfig, setPrimitives, setViewBox]);

  useEffect(() => {
    if (config.testMode) return;
    const handleMessage: MessageHandler = (event: MessageEvent) => {
      const primitiveMsg = event.message as PrimitiveArray;
      const now = Date.now();
      setPrimitives((prevPrimitives) => {
        const updatedPrimitives = new Map(prevPrimitives);
        primitiveMsg.primitives.forEach((primitive) => {
          if (primitive.namespace && !prevPrimitives.has(primitive.id)) {
            setConfig((prevConfig) => ({
              ...prevConfig,
              namespaces: {
                ...prevConfig.namespaces,
                [primitive.namespace as string]: true,
              },
            }));
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
  }, [config.topic, config.testMode, setConfig, setPrimitives]);

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
    (primitive: Primitive & { expiryTime: number } | null): JSX.Element | null => {
      if (!primitive) return null;
      const { id, type, params, color, text } = primitive;
      switch (type) {
        case 0: // CIRCLE
          return <circle key={id} cx={params[0]} cy={params[1]} r={params[2]} fill={color} />;
        case 1: // LINE
          return (
            <line
              key={id}
              x1={params[0]}
              y1={params[1]}
              x2={params[2]}
              y2={params[3]}
              stroke={color}
              strokeWidth={2}
            />
          );
        case 2: // RECTANGLE
          return (
            <rect
              key={id}
              x={params[0]}
              y={params[1]}
              width={params[2]}
              height={params[3]}
              stroke={color}
              fill="none"
              strokeWidth={2}
            />
          );
        case 3: // TEXT
          return <text key={id} x={params[0]} y={params[1]} fill={color} fontSize={12}>
            {text}
          </text>;
        case 4: // POLYGON
          const points = [];
          for (let i = 0; i < params.length; i += 2) {
            points.push(`${params[i]},${params[i + 1]}`);
          }
          return <polygon key={id} points={points.join(" ")} fill={color} />;
        default:
          return null;
      }
    },
    [config.namespaces]
  );

  useEffect(() => {
    if (!config.testMode) return;
    const intervalId = setInterval(() => {
      const testData = createTestData(Date.now() * config.testSpeed);
      const now = Date.now();
      setPrimitives((prevPrimitives) => {
        const updatedPrimitives = new Map(prevPrimitives);
        testData.forEach((primitive) => {
          updatedPrimitives.set(primitive.id, {
            ...primitive,
            expiryTime: primitive.lifetime > 0 ? now + primitive.lifetime * 1000 : Infinity,
          });
        });
        return updatedPrimitives;
      });
    }, 16);
    return () => clearInterval(intervalId);
  }, [config.testMode, config.testSpeed, setPrimitives]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();
      setPrimitives((prevPrimitives) => {
        const updatedPrimitives = new Map(prevPrimitives);
        for (const [id, primitive] of updatedPrimitives) {
          if (primitive.expiryTime <= now) {
            updatedPrimitives.delete(id);
          }
        }
        return updatedPrimitives;
      });
    }, 100);
    return () => clearInterval(intervalId);
  }, [setPrimitives]);

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
          const offsetX = (width - newWidth) / 2;
          const offsetY = (height - newHeight) / 2;
          setViewBox(`${x + offsetX} ${y + offsetY} ${newWidth} ${newHeight}`);
        }}
      >
        {config.showGrid && renderGrid()}
        {Array.from(primitives.values()).map(renderPrimitive)}
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
