import { useCallback, Dispatch, SetStateAction, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";

const PAN_VIEWBOX_PIXEL_MOTION_DIVISOR = 400; // Higher values make panning slower relative to pixel motion.
const ZOOM_IN_FACTOR = 1.2;
const ZOOM_OUT_FACTOR = 0.8;
const MAX_ZOOM_RATIO = 10; // Represents 10x zoom in or 10x zoom out from initial.

interface UsePanZoomOptions {
  initialViewBox: string;
  setViewBox: Dispatch<SetStateAction<string>>;
}

interface PanZoomHandlers {
  handleMouseDown: (event: ReactMouseEvent<SVGSVGElement>) => void;
  handleWheel: (event: ReactWheelEvent<SVGSVGElement>) => void;
}

export const usePanZoom = ({ // No direct React.* usage in function body if types are aliased/imported directly
  initialViewBox,
  setViewBox,
}: UsePanZoomOptions): PanZoomHandlers => {
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      const startX = e.clientX;
      const startY = e.clientY;
      // Assuming viewBox is a string like "x y width height"
      const [vx, vy, vwidth, vheight] = initialViewBox.split(" ").map(Number);

      const handleMouseMove = (event: MouseEvent) => {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        
        // Use a scaling factor relative to the viewBox dimensions.
        const scaledDx = (dx * vwidth) / PAN_VIEWBOX_PIXEL_MOTION_DIVISOR;
        const scaledDy = (dy * vheight) / PAN_VIEWBOX_PIXEL_MOTION_DIVISOR; // Maintain aspect ratio of panning speed

        setViewBox(`${vx - scaledDx} ${vy - scaledDy} ${vwidth} ${vheight}`);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [initialViewBox, setViewBox]
  );

  const handleWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const [x, y, width, height] = initialViewBox.split(" ").map(Number);
      const scale = e.deltaY > 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;

      // Define min/max zoom levels based on initial width/height and MAX_ZOOM_RATIO
      const minWidth = width / MAX_ZOOM_RATIO;
      const maxWidth = width * MAX_ZOOM_RATIO;
      const minHeight = height / MAX_ZOOM_RATIO;
      const maxHeight = height * MAX_ZOOM_RATIO;

      let newWidth = width * scale;
      let newHeight = height * scale;

      // Apply zoom constraints
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      
      // If new dimensions are clamped, adjust scale to maintain aspect ratio (optional)
      // This part can be tricky; for now, we'll allow aspect ratio to change slightly at limits
      // or ensure clamping logic respects aspect ratio.
      // For simplicity, current clamping might alter aspect ratio if one dimension hits limit before other.

      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const newX = centerX - newWidth / 2;
      const newY = centerY - newHeight / 2;

      setViewBox(`${newX} ${newY} ${newWidth} ${newHeight}`);
    },
    [initialViewBox, setViewBox]
  );

  return { handleMouseDown, handleWheel };
};
