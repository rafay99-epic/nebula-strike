import * as THREE from 'three';

export class Mine {
  readonly group = new THREE.Group();
  readonly radius = 2.2;
  readonly triggerRadius = 16;
  readonly damage = 38;
  alive = true;
  private lamp: THREE.Mesh;
  private lampMat: THREE.MeshStandardMaterial;
  private phase = Math.random() * Math.PI * 2;

  constructor(position: THREE.Vector3, scene: THREE.Scene) {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.6 })
    );
    this.group.add(body);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.3, 1.2, 5),
        new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.8, metalness: 0.5 })
      );
      const dir = new THREE.Vector3().randomDirection();
      spike.position.copy(dir).multiplyScalar(1.6);
      spike.lookAt(dir.clone().multiplyScalar(4));
      spike.rotateX(Math.PI / 2);
      this.group.add(spike);
    }
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0x220000, emissive: 0xff2222, emissiveIntensity: 2.5,
    });
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), this.lampMat);
    this.lamp.position.y = 1.7;
    this.group.add(this.lamp);
    this.group.position.copy(position);
    scene.add(this.group);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  update(dt: number, time: number): void {
    this.group.rotation.y += dt * 0.4;
    // menacing blink, faster pulse reads as armed
    this.lampMat.emissiveIntensity = 1.2 + Math.abs(Math.sin(time * 4 + this.phase)) * 2.6;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    });
  }
}
