// This file will contain the usePanelConfig custom React hook.
import { useState, useCallback } from "react";
import { PanelConfig } from "../settings_utils"; // Import PanelConfig type (NamespaceConfig is used via PanelConfig)

interface UsePanelConfigOptions {
  defaultConfig: PanelConfig;
  initialState?: Partial<PanelConfig>; // initialState from context can be partial
}

interface PanelConfigUpdaters {
  config: PanelConfig;
  setBackgroundColor: (color: string) => void;
  setViewBoxWidth: (width: number) => void;
  setNamespaceVisibility: (layerPath: string | string[], isVisible: boolean) => void;
  initializeNamespaces: (layers: string[]) => void;
}

export const usePanelConfig = ({
  defaultConfig,
  initialState,
}: UsePanelConfigOptions): PanelConfigUpdaters => {
  const [config, setConfig] = useState<PanelConfig>(() => {
    const mergedConfig = { ...defaultConfig };
    if (initialState) {
      mergedConfig.backgroundColor = initialState.backgroundColor ?? defaultConfig.backgroundColor;
      mergedConfig.viewBoxWidth = initialState.viewBoxWidth ?? defaultConfig.viewBoxWidth;
      // Deep merge for namespaces is more complex, handle it carefully
      // For now, simple overwrite, but ideally, it should be a deep merge
      mergedConfig.namespaces = initialState.namespaces ? JSON.parse(JSON.stringify(initialState.namespaces)) : defaultConfig.namespaces;
    }
    return mergedConfig;
  });

  const setBackgroundColor = useCallback((color: string) => {
    setConfig((prevConfig) => ({ ...prevConfig, backgroundColor: color }));
  }, []);

  const setViewBoxWidth = useCallback((width: number) => {
    setConfig((prevConfig) => ({ ...prevConfig, viewBoxWidth: width }));
  }, []);

  const setNamespaceVisibility = useCallback(
    (layerPath: string | string[], isVisible: boolean) => {
      setConfig((prevConfig) => {
        const newConfig = JSON.parse(JSON.stringify(prevConfig)); // Deep clone
        let current = newConfig.namespaces;
        const pathArray = Array.isArray(layerPath) ? layerPath : layerPath.split("/"); // Assuming '/' delimiter if string

        pathArray.forEach((part, index) => {
          if (index === pathArray.length - 1) {
            if (!current[part]) {
              current[part] = { visible: isVisible, children: {} }; // Initialize if not exists
            } else {
              current[part].visible = isVisible;
            }
          } else {
            if (!current[part]) {
              current[part] = { visible: true, children: {} }; // Create path if not exists
            }
            if (!current[part].children) {
                current[part].children = {}; // Ensure children object exists
            }
            current = current[part].children;
          }
        });
        return newConfig;
      });
    },
    []
  );

  const initializeNamespaces = useCallback((layers: string[]) => {
    setConfig((prevConfig) => {
      const newConfig = JSON.parse(JSON.stringify(prevConfig)); // Deep clone
      let changed = false;
      layers.forEach((layer) => {
        // This correctly handles hierarchical layer paths like "parent/child"
        const pathArray = layer.split("/");
        let current = newConfig.namespaces;
        pathArray.forEach((part, index) => {
            if (index === pathArray.length -1 ) {
                if(!current[part]) {
                    current[part] = { visible: true };
                    changed = true;
                }
            } else {
                if (!current[part]) {
                    current[part] = { visible: true, children: {} };
                    changed = true; 
                }
                 if (!current[part].children) {
                    current[part].children = {}; // Ensure children object exists
                    changed = true;
                }
                current = current[part].children;
            }
        });
      });
      return changed ? newConfig : prevConfig;
    });
  }, []);

  return {
    config,
    setBackgroundColor,
    setViewBoxWidth,
    setNamespaceVisibility,
    initializeNamespaces,
  };
};
