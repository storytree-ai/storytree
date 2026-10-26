/** Capability 4 · The planet. DOM laid over the canvas (drei's Html), its host fixed when it first mounts. */
import { useState, type ComponentProps } from 'react';
import { useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';

/**
 * Html with its host pinned to the canvas's parent. Unpinned, Html follows wherever the canvas connects its events, which
 * changes as the canvas first mounts, inside React's own commit: Html then unmounts its React root there (React logs
 * "synchronously unmount a root while React was already rendering") and its content is lost. The pinned host also holds
 * while the canvas disconnects its events on a project switch.
 */
export function Overlay(props: ComponentProps<typeof Html>) {
  const gl = useThree((state) => state.gl);
  const [portal] = useState(() => ({ current: gl.domElement.parentElement! }));
  return <Html {...props} portal={portal} />;
}
