// This file will contain settings-related utility functions and type definitions.

import { SettingsTreeField, SettingsTreeAction } from "@foxglove/studio";

export interface NamespaceConfig {
  visible: boolean;
  children?: { [key: string]: NamespaceConfig };
}

export interface PanelConfig {
  backgroundColor: string;
  viewBoxWidth: number;
  namespaces: { [key: string]: NamespaceConfig };
}

export const createNamespaceFields = (namespaces: { [key: string]: NamespaceConfig }): { [key: string]: SettingsTreeField } => {
  const fields: { [key: string]: SettingsTreeField } = {};
  const addFieldsRecursive = (ns: { [key: string]: NamespaceConfig }, path: string[] = []) => {
    for (const [name, { visible, children }] of Object.entries(ns)) {
      const currentPath = [...path, name];
      const key = currentPath.join(".");
      fields[key] = {
        label: name,
        input: "boolean",
        value: visible,
          help: "Show/hide namespace", // Translated from Japanese
      };
      if (children) {
        addFieldsRecursive(children, currentPath);
      }
    }
  };
  addFieldsRecursive(namespaces);
  return fields;
};

interface SettingsUpdaters {
  setTopic: (topic: string) => void;
  setBackgroundColor: (color: string) => void;
  setViewBoxWidth: (width: number) => void;
  setNamespaceVisibility: (layerPath: string | string[], isVisible: boolean) => void;
}

export const handleSettingsAction = (
  action: SettingsTreeAction,
  // config: PanelConfig, // config is not directly used for updates, updaters directly change state
  updaters: SettingsUpdaters
): void => {
  const path = action.payload.path; // This is an array of strings

  if (action.action === "update") {
    const topLevelKey = path[0];
    const settingKey = path[1]; // For "general" settings

    switch (topLevelKey) {
      case "general":
        if (!settingKey) return; // Should not happen with valid paths
        switch (settingKey) {
          case "topic":
            updaters.setTopic(action.payload.value as string);
            break;
          case "backgroundColor":
            updaters.setBackgroundColor(action.payload.value as string);
            break;
          case "viewBoxWidth":
            updaters.setViewBoxWidth(action.payload.value as number);
            break;
          default:
            console.warn(`Unhandled general setting: ${path.join(".")}`);
        }
        break;
      case "namespaces":
        // Path for namespaces is like ["namespaces", "parent", "child", "grandchild"]
        // The setNamespaceVisibility function takes the path parts after "namespaces"
        const namespacePathArray = path.slice(1);
        const isVisible = action.payload.value as boolean;
        if (namespacePathArray.length > 0) {
          updaters.setNamespaceVisibility(namespacePathArray, isVisible);
        } else {
          console.warn(`Invalid namespace path: ${path.join(".")}`);
        }
        break;
      default:
        console.warn(`Unhandled settings action path: ${path.join(".")}`);
    }
  } else if (action.action === "perform-node-action") {
    // Handle any node actions if necessary in the future
    console.log(`Node action performed: ${action.payload.id}`);
  }
};
