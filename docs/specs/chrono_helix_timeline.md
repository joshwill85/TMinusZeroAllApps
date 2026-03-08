# Technical Specification: The "Chrono-Helix" Launch Timeline

## 1. Overview
The **Chrono-Helix** is a specialized UI component designed to visualize the history and future of a specific rocket vehicle's launches. Unlike traditional linear lists, this component renders launch nodes along a 3D helical path (corkscrew), providing a spatial representation of time.

The current launch acts as the focal point (the "Hero" node), with past launches spiraling downwards into the background and future launches spiraling upwards.

## 2. Technical Approach
To maintain performance and ensuring seamless integration with the existing Next.js/Tailwind DOM structure, we will utilize **CSS 3D Transforms** rather than a WebGL canvas (Three.js/R3F). This ensures:
1.  **Searchability/Selectability:** Text remains standard HTML.
2.  **Accessibility:** Screen readers can traverse the DOM naturally.
3.  **Styling:** standard Tailwind classes apply to the cards.

### 2.1 Coordinate System & Geometry
The helix is defined using a cylindrical coordinate system mapped to CSS `translate3d(x, y, z)`.

**Parameters:**
*   `R` (Radius): The distance of cards from the central vertical axis (e.g., `300px`).
*   `H` (Vertical Step): The vertical distance between consecutive nodes (e.g., `80px`).
*   `A` (Angular Step): The rotation angle between consecutive nodes (e.g., `30deg` or `0.52rad`).
*   `Offset` (Scroll Position): A continuous float value representing the current "scroll" state.

**Formula for Node `i`:**
Given the currently focused index `f` (which can be fractional during animation):
1.  **Relative Index:** `delta = i - f`
2.  **Angle:** `theta = delta * A`
3.  **Vertical Position (Y):** `y = delta * H`
4.  **Horizontal Position (X):** `x = R * sin(theta)`
5.  **Depth Position (Z):** `z = R * cos(theta) - R` 
    *   *Note: We subtract R so the "active" item (theta=0) sits at Z=0 (screen plane), and others recede to negative Z.*

**Transformation Matrix:**
Each node receives a style object:
```css
transform: translate3d(${x}px, ${y}px, ${z}px);
opacity: ${calculatedOpacity};
scale: ${calculatedScale};
z-index: ${calculatedZIndex};
```

## 3. Component Architecture

### 3.1 `HelixContainer`
The wrapper component responsible for the 3D perspective context and gesture handling.

*   **Props:** `launches: Launch[]`, `initialLaunchId: string`
*   **State:** 
    *   `activeIndex`: number (float for smooth animating, integer for snapping).
    *   `isDragging`: boolean.
*   **Styles:**
    *   `perspective: 1000px;` (Controls the intensity of the 3D effect).
    *   `perspective-origin: center center;`
    *   `overflow: hidden;`

### 3.2 `HelixTrack`
A `div` that acts as the world space. It does not rotate itself; instead, we manipulate the individual nodes. This simplifies the mental model for click targets.

*   **Styles:** `position: relative; height: 100%; width: 100%; transform-style: preserve-3d;`

### 3.3 `LaunchNode`
The individual card component.

*   **Props:** `launch: Launch`, `offset: number` (its calculated position relative to focus).
*   **Visual States:**
    *   **Hero (Current):** Opacity 1.0, Scale 1.0, full detail, "T-Minus" ring visible.
    *   **Immediate Neighbor:** Opacity 0.6, Scale 0.8, reduced detail (Date + Status).
    *   **Distant:** Opacity < 0.3, Scale < 0.6, dot/icon only.
*   **Interaction:** Clicking a non-active node triggers a `scrollTo(index)` action.

## 4. Interaction & Physics

### 4.1 Input Methods
1.  **Touch/Drag:** Standard 1:1 touch tracking mapped to the `activeIndex` delta.
2.  **Wheel:** Vertical scroll wheel mapped to `activeIndex`.
3.  **Keyboard:** Arrow Up/Down to step through launches.

### 4.2 Physics Model
Use a spring physics library (e.g., `framer-motion` or `react-spring`) for the `activeIndex` value.
*   **Damping:** High damping to prevent excessive oscillation.
*   **Stiffness:** Medium stiffness for snappy response.
*   **Snap-to-Grid:** When input is released, the value must animate to the nearest integer `Math.round(activeIndex)`.

## 5. Visual "Ahead of its Time" Features

### 5.1 The "Time Thread" (SVG Connector)
An SVG line that connects the nodes. Since nodes are in 3D space, drawing a simple line is tricky.
*   **Solution:** Use a single SVG layer *behind* the nodes (in Z-space).
*   **Implementation:** Calculate the 2D projected coordinates (x, y) of each node's center based on the perspective formula and draw a cubic bezier curve connecting them. This creates a smooth "DNA strand" look.

### 5.2 Depth Cueing (Fog)
Items further back in Z-space (negative Z) should fade into the background color.
*   **Implementation:** Map `z` value to CSS `opacity` and `blur`.
    *   `filter: blur(${Math.abs(z) / 100}px);`

### 5.3 Ghost Comparisons
When the "Hero" node is active, render a "Ghost" label near it if the previous launch had a significant delta (e.g., "Fastest Turnaround: 12 days"). This text should float freely in 3D space near the connector line.

## 6. Data Requirements
The `Launch` object needs to be mapped to a lightweight display interface:
```typescript
interface TimelineNode {
  id: string;
  date: Date;
  status: 'success' | 'failure' | 'upcoming';
  vehicleName: string; // e.g., "Falcon 9 B1060.1"
  missionName: string;
  isCurrent: boolean;
}
```
*Note: Ensure the array is sorted chronologically.*

## 7. Accessibility (A11y)
Since the visual order (Z-space) might differ from DOM order:
1.  **ARIA:** The list should be `role="list"`. Items are `role="listitem"`.
2.  **Focus Management:** Ensure the "Active" item receives `aria-current="step"`.
3.  **Reduced Motion:** Respect `prefers-reduced-motion`. If true, disable the 3D transforms and display a standard flat vertical list.
