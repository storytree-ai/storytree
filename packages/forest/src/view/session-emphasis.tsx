// Capability 7 · Running sessions
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { Group, Mesh, ShaderMaterial, type Material } from "three";
import { restoreTerritoryPresentation } from "./globe-surfaces.js";

export type SessionEmphasis = "held" | "dimmed" | undefined;

export function SessionIslandEmphasis({ emphasis }: { emphasis: SessionEmphasis }) {
  const anchor = useRef<Group>(null);
  const saved = useRef(new Map<Mesh, { original: Material | Material[]; copies: Material[] }>());
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    const plate = anchor.current?.parent;
    if (!plate) return;
    if (emphasis) plate.userData.sessionEmphasis = emphasis;
    invalidate();
    return () => {
      delete plate.userData.sessionEmphasis;
      for (const [mesh, { original, copies }] of saved.current) {
        mesh.material = original;
        for (const material of copies) material.dispose();
      }
      saved.current.clear();
      restoreTerritoryPresentation(plate);
      invalidate();
    };
  }, [emphasis, invalidate]);
  useFrame(() => {
    if (!emphasis) return;
    anchor.current?.parent?.traverse(object => {
      if (!(object instanceof Mesh) || object.name.startsWith("session-highlight:") || saved.current.has(object)
        || object.parent?.userData.sessionWisp !== undefined || object.userData.traversal === true) return;
      const original: Material | Material[] = object.material;
      const copies = (Array.isArray(original) ? original : [original]).map(source => {
        const copy = source.clone();
        if (source instanceof ShaderMaterial && copy instanceof ShaderMaterial) copy.uniforms = { ...source.uniforms };
        const hook = source.onBeforeCompile;
        const cacheKey = source.customProgramCacheKey;
        const brightness = emphasis === "held" ? 1.16 : 0.24;
        copy.userData = { ...copy.userData, sessionBrightness: brightness };
        copy.onBeforeCompile = function(shader, renderer) {
          hook.call(this, shader, renderer);
          shader.uniforms.uSessionBrightness = { value: brightness };
          shader.fragmentShader = `uniform float uSessionBrightness;\n${shader.fragmentShader}`
            .replace(/}\s*$/, "  gl_FragColor.rgb *= uSessionBrightness;\n}");
        };
        copy.customProgramCacheKey = () => `${cacheKey.call(source)}|session-brightness:${brightness}`;
        return copy;
      });
      saved.current.set(object, { original, copies });
      object.material = Array.isArray(original) ? copies : copies[0]!;
    });
  });
  return <group ref={anchor} />;
}
