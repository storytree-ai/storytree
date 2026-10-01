// ForestWorldCanvas.underlay.ts — the canvas's delivery decisions, standalone or as a host's
// underlay, kept pure and apart from the canvas so they are provable without a GPU and testable
// without loading React, @react-three/fiber, drei and three (`ForestWorldCanvas.underlay.test.ts`).
// ForestWorldCanvas.tsx renders by this decision and re-exports it on the `./canvas` subpath.

/** What a host hands over when it owns the camera — {@link registrationCamera}'s answer, plus the
 *  one composition choice a host still has. */
export interface RegisteredUnderlay {
  /** Delivered CSS px per world unit — the host's own scale, one number for the whole frame. */
  readonly zoom: number;
  /** The ground point at the centre of the frame, in this canvas's own ground coordinates. */
  readonly target: { readonly x: number; readonly z: number };
  /**
   * Draw the kit props as well as the ground. **Default false, and the default is the decision.**
   *
   * ⚠ A HOST THAT ALREADY DRAWS ITS OWN CANOPY MUST NOT GET A SECOND ONE. The studio's SVG layer
   * draws a crown per story and a flora bed per capability, and those are the marks its legend
   * describes and its status vocabulary is read from. Drawing the 3D kit underneath them yields
   * two canopies for one forest; drawing the 3D kit INSTEAD would move a status signal onto a
   * channel whose per-prop status-carrying question is explicitly still open (ADR-0530 D3). So the
   * ground mounts first and the props wait for that answer — which is ADR-0530 D6 staging, stated
   * rather than smuggled.
   */
  readonly props?: boolean;
}

/** WHAT REGISTERED MODE CHANGES — every one of the canvas's delivery decisions, as one object. */
export interface UnderlayComposition {
  /** Extra `<Canvas>` props. Presentable canvases render on demand; parked or hidden ones never
   * paint. Registered canvases use a transparent drawing buffer and are pointer-inert. */
  readonly canvasProps: {
    readonly frameloop: 'demand' | 'never';
    readonly gl?: { readonly alpha: boolean };
    readonly style?: { readonly pointerEvents: 'none' };
  };
  /** Paint this canvas's own dark board behind the world. */
  readonly backdrop: boolean;
  /** Draw the kit props. */
  readonly props: boolean;
  /** Draw the trail strips. */
  readonly trails: boolean;
  /** Draw the cave arches. */
  readonly caves: boolean;
  /** Draw the wisp sprites. */
  readonly wisps: boolean;
  /** Mount `MapControls` — i.e. let THIS canvas own pan and zoom. */
  readonly controls: boolean;
}

/**
 * THE CANVAS'S DELIVERY DECISIONS, MADE ONCE — standalone, or as a host's underlay.
 *
 * ⚠ IT IS A FUNCTION RATHER THAN FIVE TERNARIES IN THE JSX because these are not five independent
 * switches, they are one decision with six consequences, and the JSX is the one place in this file
 * a headless test cannot reach (a `<Canvas>` needs a WebGL context). Naming it makes the whole
 * composition provable without a GPU, which is what `ForestWorldCanvas.underlay.test.ts` does.
 *
 * ⚠ `frameloop: 'demand'` IS ALSO THE REDUCED-MOTION ANSWER, and it is a real answer rather than a
 * convenient one. Nothing on this canvas animates — no `useFrame`, no clock, no asset-owned
 * timeline (ADR-0380 D6 fence 5) — so under a host it redraws only when its camera or its content
 * moved. A surface with no motion has none to reduce, and the honest implementation of that is a
 * render loop that does not run rather than a media query that turns one off. Standalone also uses
 * demand frames: `MapControls` invalidates when its pan or zoom changes.
 *
 * ⚠ AND EVERY `false` BELOW IS A MARK THE HOST ALREADY DRAWS. Caves and wisps exist in the host's
 * own layer above (`forest-world`'s `buildScene` emits them), so drawing them here would be a
 * SECOND drawing of one mark — two wisps, two cave mouths. The props are the one entry a host may
 * ask for, and only to stage a picture.
 *
 * ⚠⚠ `trails` IS THE EXCEPTION, AND IT IS A PRODUCT-STATE RULE RATHER THAN A DEBUG PROP — which is
 * the change `pathways-keep-selection-focus-and-accessible-edge-identity` asks for. It was `false`
 * under a host for the same reason as the rest, and that was the honest answer only while the host
 * still drew its own visible paths. Under a mount the 3D layer is the one that can draw a pathway
 * ON the ground it actually runs over — routed, docked, following the relief — so the rule is:
 * **mounted ⇒ the 3D layer owns the paths**, derived from the mount itself and never passed in as a
 * boolean a caller could get wrong.
 *
 * ⚠ IT IS HALF A DECISION ON ITS OWN, AND THE OTHER HALF IS THE HOST'S. Turning this on WITHOUT the
 * host suppressing its own path strokes is the double-drawing the row exists to remove. The two are
 * landed together and tied by a test; `showTrails` stays what it always was — the STANDALONE
 * harness's opt-in — and is ignored under a host, because a host's answer is not a debug choice.
 */
export function underlayComposition(
  registered: RegisteredUnderlay | undefined,
  showTrails = false,
  presentable: { readonly active: boolean; readonly documentVisible: boolean } = {
    active: true,
    documentVisible: true,
  },
): UnderlayComposition {
  const frameloop = presentable.active && presentable.documentVisible ? 'demand' : 'never';
  if (!registered) {
    return {
      canvasProps: { frameloop },
      backdrop: true,
      props: true,
      // ⚠ THE STANDALONE BRANCH IS THE ONLY PLACE `showTrails` IS READ, and it keeps its old
      // meaning exactly: trails are HIDDEN BY DEFAULT on a harness page (ADR-0169 §3) and a page
      // opts in. Threading it through here rather than gating at the call site is what makes
      // `compose.trails` the ONE gate, so a reader never has to find a second condition.
      trails: showTrails,
      caves: true,
      wisps: true,
      controls: true,
    };
  }
  return {
    // R3F's wrapper explicitly defaults to pointer-events:auto, overriding the host's inherited
    // none. Set its own style so the registered canvas stays outside hit testing beneath the SVG.
    canvasProps: { frameloop, gl: { alpha: true }, style: { pointerEvents: 'none' } },
    backdrop: false,
    props: registered.props === true,
    // ⚠ NOT `registered.showTrails` AND NOT A FIELD — see the doc comment. Mounted means the 3D
    // layer owns the paths, so there is nothing for a caller to pass and nothing to get wrong.
    trails: true,
    caves: false,
    wisps: false,
    controls: false,
  };
}
