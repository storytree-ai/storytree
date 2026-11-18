// Capability 1 · Scene layout

export interface Transform3D {
  x: number;
  y: number;
  z: number;
}

export interface InstanceDescriptor {
  kind: 'cell-ground';
  transform: Transform3D;
  group: 'cell-ground';
  material?: string;
  points?: Transform3D[];
  island?: string;
  parcel?: string;
}

export type Descriptor3D = InstanceDescriptor;
