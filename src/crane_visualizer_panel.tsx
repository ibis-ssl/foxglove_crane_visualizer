import { useCallback, useLayoutEffect, useState, useEffect, FC, memo } from "react";
import {
  PanelExtensionContext,
  SettingsTree,
  SettingsTreeAction,
  SettingsTreeField,
  MessageEvent,
  Topic,
  Subscription,
  Immutable,
} from "@foxglove/studio";
import ReactDOM from "react-dom";
import { StrictMode } from "react";
import { usePanZoom } from "./hooks/usePanZoom";
import { usePanelConfig } from "./hooks/usePanelConfig"; // Hook import
import { PanelConfig, NamespaceConfig } from "../settings_utils"; // Type imports
import { createNamespaceFields, handleSettingsAction } from "../settings_utils"; // Import utils
import { DEFAULT_TOPIC, DEFAULT_VIEWBOX_ASPECT_RATIO } from "../constants"; // Import constants

interface SvgPrimitiveArray {
  layer: string; // "parent/child1/child2"のような階層パス
  svg_primitives: string[];
}

interface SvgLayerArray {
  svg_primitive_arrays: SvgPrimitiveArray[];
}

// PanelConfig and NamespaceConfig are now imported from ../settings_utils.ts

const defaultConfigForHook: PanelConfig = {
  backgroundColor: "#585858ff",
  viewBoxWidth: 10000,
  namespaces: {},
};


const CraneVisualizer: React.FC<{ context: PanelExtensionContext }> = ({ context }) => {
  const [viewBox, setViewBox] = useState("-5000 -3000 10000 6000");
  const { handleMouseDown, handleWheel } = usePanZoom({ initialViewBox: viewBox, setViewBox });
  const {
    config,
    setBackgroundColor,
    setViewBoxWidth,
    setNamespaceVisibility,
    initializeNamespaces,
  } = usePanelConfig({ defaultConfig: defaultConfigForHook, initialState: context.initialState as Partial<PanelConfig> });
  const [topic, setTopic] = useState<string>(DEFAULT_TOPIC); // Use constant for default topic
  const [topics, setTopics] = useState<undefined | Immutable<Topic[]>>(); // Stores list of all topics
  const [messages, setMessages] = useState<undefined | Immutable<MessageEvent[]>>(); // Stores current frame messages
  const [renderDone, setRenderDone] = useState<(() => void) | undefined>();
  const [receivedMessageCount, setReceivedMessageCount] = useState(0); // Renamed from recv_num
  const [latest_msg, setLatestMsg] = useState<SvgLayerArray>(); // Stores the latest SvgLayerArray message

  // Resets the SVG viewBox to its default position and zoom level based on the current config.viewBoxWidth.
  const resetViewBox = useCallback(() => {
    const x = -config.viewBoxWidth / 2;
    const height = config.viewBoxWidth * DEFAULT_VIEWBOX_ASPECT_RATIO; // Use constant
    const y = -height / 2;
    setViewBox(`${x} ${y} ${config.viewBoxWidth} ${height}`);
  }, [setViewBox, config.viewBoxWidth]);

  // Effect to handle 'Ctrl+0' for resetting the view.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "0") {
        event.preventDefault(); // Prevent browser default action for Ctrl+0
        resetViewBox();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [resetViewBox]); // Depends on resetViewBox callback

  // Subscribes to the selected topic when the topic or context changes.
  useEffect(() => {
    // Panel is responsible for managing its subscriptions
    context.subscribe([{ topic }]);
    return () => {
      // Unsubscribe when the topic changes or the panel is unmounted
      context.unsubscribe([{ topic }]);
    };
  }, [topic, context]); // Added context as a dependency, as context.subscribe/unsubscribe are used.

  // Saves the current panel configuration when it changes.
  useLayoutEffect(() => {
    context.saveState(config);
  }, [config, context]); // Depends on config and context.saveState

  // The useLayoutEffect that loaded context.initialState is now handled by usePanelConfig.

  // Updates the panel settings editor when config or topic-related states change.
  useEffect(() => {
    const updatePanelSettings = () => {
      const panelSettings: SettingsTree = {
        nodes: {
          general: {
            label: "General",
            fields: {
              topic: { label: "Topic Name", input: "string", value: topic }, //トピック名 -> Topic Name
              backgroundColor: { label: "Background Color", input: "rgba", value: config.backgroundColor }, //背景色 -> Background Color
              viewBoxWidth: { label: "ViewBox Width", input: "number", value: config.viewBoxWidth }, //ViewBox 幅 -> ViewBox Width
            },
          },
          namespaces: {
            label: "Namespaces", //名前空間 -> Namespaces
            fields: createNamespaceFields(config.namespaces),
          },
        },
        actionHandler: (action: SettingsTreeAction) => {
          handleSettingsAction(action, {
            setTopic,
            setBackgroundColor,
            setViewBoxWidth,
            setNamespaceVisibility,
          });
        },
      };
      context.updatePanelSettingsEditor(panelSettings);
    };

    updatePanelSettings();
  }, [context, config, topic, setTopic, setBackgroundColor, setViewBoxWidth, setNamespaceVisibility]); // Added setTopic to dependencies

  // createNamespaceFields moved to ../settings_utils.ts


  // This layout effect sets up the callback for Foxglove Studio to signal rendering.
  // It provides `done` which should be called when the panel has completed its rendering pass.
  // It also receives the current frame's messages and the list of all available topics.
  useLayoutEffect(() => {
    // renderState contains currentFrame and topics.
    // done is a callback to signal that rendering is complete.
    context.onRender = (renderState, done) => {
      setRenderDone(() => done); // Store the done callback to be called after state updates.
      setMessages(renderState.currentFrame); // Update messages from the current frame.
      if (renderState.topics) { // Update the list of all available topics.
          setTopics(renderState.topics);
      }
    };

    context.watch("topics"); // Watch for changes in topic list.
    context.watch("currentFrame"); // Watch for new messages.

  }, [context]); // Effect only needs to run once to set up the onRender handler, and if context changes.

  // Processes incoming messages when `messages` or `topic` state changes.
  // It filters messages for the selected topic, updates the latest message,
  // increments a counter, and initializes namespaces based on received SVG layers.
  useEffect(() => {
    if (messages) {
      for (const message of messages) {
        if (message.topic === topic) {
          const msg = message.message as SvgLayerArray;
          setLatestMsg(msg);
          setReceivedMessageCount((prevCount) => prevCount + 1); // Use new setter

          const layers = msg.svg_primitive_arrays.map(arr => arr.layer);
          initializeNamespaces(layers); // Initialize namespaces from the new message
        }
      }
    }
  }, [messages, topic, initializeNamespaces]); // Depends on messages, topic, and initializeNamespaces.

  // This effect calls the `done` callback received from `onRender` after the panel has processed
  // new messages and updated its state, signaling to Foxglove Studio that the render pass is complete.
  useEffect(() => {
    if (renderDone) {
      renderDone();
    }
  }, [renderDone, latest_msg, config]); // Call done when renderDone is set and after relevant states (latest_msg, config) are updated.

// InfoDisplay component to show Topic and Received Message Count
const InfoDisplay: FC<{ topic: string; receivedMessageCount: number }> = memo(({ topic, receivedMessageCount }) => (
  <div style={{ padding: "0.25rem 0.5rem", backgroundColor: "#222222", color: "#cccccc", display:"flex", gap:"1rem" }}>
    <p>Topic: {topic}</p>
    <p>Receive num: {receivedMessageCount}</p>
  </div>
));

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <InfoDisplay topic={topic} receivedMessageCount={receivedMessageCount} />
      <div style={{ flexGrow: 1, overflow: "hidden" }}> 
        {/* flexGrow: 1 allows this div to take remaining space */}
        <svg
          width="100%"
          height="100%"
          viewBox={viewBox}
          style={{ backgroundColor: config.backgroundColor }}
          {...{ onMouseDown: handleMouseDown, onWheel: handleWheel }}
        >
          {latest_msg && latest_msg.svg_primitive_arrays.map((svg_primitive_array) => (
            <g key={svg_primitive_array.layer} style={{ display: config.namespaces[svg_primitive_array.layer]?.visible ? 'block' : 'none' }}>
              {svg_primitive_array.svg_primitives.map((svg_primitive) => (
                <g key={svg_primitive} dangerouslySetInnerHTML={{ __html: svg_primitive }} />
              ))}
            </g>
          ))}
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
    context.panelElement
  );
  return () => {
    ReactDOM.unmountComponentAtNode(context.panelElement);
  };
}
