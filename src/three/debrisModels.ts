import * as THREE from 'three';
import type { DebrisCategory } from '../types/orbital.ts';

function createSolarCellTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c2340';
  ctx.fillRect(0, 0, 256, 128);

  ctx.strokeStyle = '#38bdf8';
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let x = 0; x <= 256; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  for (let y = 0; y <= 128; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds composite 3-12 part procedural 3D spacecraft/debris models
 * with realistic PBR roughness/metalness contrast for close-up inspection
 * on both the main 3D globe and the 24x Optical Chase Camera.
 */
export function createCompositeDebrisModel(category: DebrisCategory): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const regGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const regMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const titaniumMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      metalness: 0.88,
      roughness: 0.24,
    })
  );
  const darkCarbonMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.25,
      roughness: 0.78,
    })
  );
  const goldMliMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.94,
      roughness: 0.2,
    })
  );
  const crimsonMarkerMat = regMat(
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      metalness: 0.35,
      roughness: 0.55,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.45,
    })
  );

  if (category === 'ROCKET_BODY') {
    // 1. Primary cylindrical cryo tank
    const tank = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.36, 0.36, 1.4, 24)), titaniumMat);
    group.add(tank);

    // 2. Interstage dark composite collar
    const collar = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 24)), darkCarbonMat);
    collar.position.y = 0.56;
    group.add(collar);

    // 3. Gold MLI aft thermal ring
    const mliRing = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.37, 0.37, 0.24, 24)), goldMliMat);
    mliRing.position.y = -0.52;
    group.add(mliRing);

    // 4. LatheGeometry flared bell nozzle
    const bellPts = [
      new THREE.Vector2(0.08, 0),
      new THREE.Vector2(0.11, -0.1),
      new THREE.Vector2(0.24, -0.32),
      new THREE.Vector2(0.31, -0.52),
    ];
    const nozzle = new THREE.Mesh(regGeo(new THREE.LatheGeometry(bellPts, 24)), darkCarbonMat);
    nozzle.position.y = -0.7;
    group.add(nozzle);

    // 5. Payload adapter cone
    const adapter = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.22, 0.36, 0.26, 24)), titaniumMat);
    adapter.position.y = 0.83;
    group.add(adapter);

    // 6. Telemetry band & umbilical pipes
    for (let i = 0; i < 3; i++) {
      const pipe = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 8)), crimsonMarkerMat);
      const angle = (i * Math.PI * 2) / 3;
      pipe.position.set(Math.cos(angle) * 0.38, 0, Math.sin(angle) * 0.38);
      group.add(pipe);
    }
  } else if (category === 'STATION') {
    const solarTex = createSolarCellTexture();
    textures.push(solarTex);
    const solarMat = regMat(
      new THREE.MeshStandardMaterial({
        map: solarTex,
        metalness: 0.55,
        roughness: 0.28,
      })
    );

    // 1. Integrated truss spine
    const truss = new THREE.Mesh(regGeo(new THREE.BoxGeometry(2.6, 0.12, 0.14)), titaniumMat);
    group.add(truss);

    // 2. Pressurized core modules
    const core = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.18, 0.18, 1.45, 20)), titaniumMat);
    core.rotation.x = Math.PI / 2;
    group.add(core);

    const node = new THREE.Mesh(regGeo(new THREE.SphereGeometry(0.22, 16, 16)), goldMliMat);
    node.position.z = 0.25;
    group.add(node);

    // 3. 4 Dual-wing solar arrays
    const wingGeo = regGeo(new THREE.BoxGeometry(0.42, 0.02, 1.25));
    const offsets = [-1.05, -0.68, 0.68, 1.05];
    for (const x of offsets) {
      const wTop = new THREE.Mesh(wingGeo, solarMat);
      wTop.position.set(x, 0, 0.72);
      group.add(wTop);

      const wBot = new THREE.Mesh(wingGeo, solarMat);
      wBot.position.set(x, 0, -0.72);
      group.add(wBot);
    }

    // 4. Thermal radiators
    const rad = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.28, 0.02, 0.55)), darkCarbonMat);
    rad.position.set(0, 0.16, -0.45);
    group.add(rad);
  } else if (category === 'PAYLOAD') {
    const solarTex = createSolarCellTexture();
    textures.push(solarTex);
    const solarMat = regMat(
      new THREE.MeshStandardMaterial({
        map: solarTex,
        metalness: 0.55,
        roughness: 0.28,
      })
    );

    // 1. Octagonal satellite bus
    const bus = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.38, 0.38, 0.72, 8)), goldMliMat);
    group.add(bus);

    // 2. Instrument bay collar
    const collar = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.32, 0.34, 0.22, 8)), darkCarbonMat);
    collar.position.y = 0.45;
    group.add(collar);

    // 3. Parabolic high-gain dish (LatheGeometry)
    const dishPts = [
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(0.14, 0.03),
      new THREE.Vector2(0.28, 0.11),
      new THREE.Vector2(0.36, 0.22),
    ];
    const dish = new THREE.Mesh(regGeo(new THREE.LatheGeometry(dishPts, 24)), titaniumMat);
    dish.position.y = 0.56;
    group.add(dish);

    // 4. Feed horn spike
    const horn = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.02, 0.03, 0.28, 8)), darkCarbonMat);
    horn.position.y = 0.7;
    group.add(horn);

    // 5. Left & right solar array wings
    const wingGeo = regGeo(new THREE.BoxGeometry(1.1, 0.025, 0.44));
    const wingL = new THREE.Mesh(wingGeo, solarMat);
    wingL.position.set(-0.92, 0.05, 0);
    wingL.rotation.x = 0.3;
    group.add(wingL);

    const wingR = new THREE.Mesh(wingGeo, solarMat);
    wingR.position.set(0.92, 0.05, 0);
    wingR.rotation.x = 0.3;
    group.add(wingR);
  } else {
    // FRAGMENTATION DEBRIS: jagged torn hull shard + structural rib + thermal foil strip
    const shape = new THREE.Shape();
    shape.moveTo(-0.48, -0.22);
    shape.lineTo(-0.18, -0.42);
    shape.lineTo(0.45, -0.15);
    shape.lineTo(0.52, 0.24);
    shape.lineTo(0.08, 0.46);
    shape.lineTo(-0.38, 0.28);
    shape.closePath();

    const plateGeo = regGeo(
      new THREE.ExtrudeGeometry(shape, {
        depth: 0.08,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 2,
      })
    );
    plateGeo.center();
    const plate = new THREE.Mesh(plateGeo, titaniumMat);
    group.add(plate);

    // Torn thermal blanket strip
    const foil = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.54, 0.18, 0.03)), goldMliMat);
    foil.position.set(0.14, 0.08, 0.08);
    foil.rotation.set(0.25, 0.4, -0.35);
    group.add(foil);

    // Exposed structural carbon rib
    const rib = new THREE.Mesh(regGeo(new THREE.BoxGeometry(0.88, 0.07, 0.14)), darkCarbonMat);
    rib.position.set(-0.04, -0.06, -0.05);
    rib.rotation.z = 0.42;
    group.add(rib);

    // Sheared bracket + crimson sensor transponder highlight
    const bracket = new THREE.Mesh(regGeo(new THREE.CylinderGeometry(0.06, 0.08, 0.26, 8)), crimsonMarkerMat);
    bracket.position.set(-0.22, 0.15, 0.06);
    bracket.rotation.set(0.8, 0.2, 0.4);
    group.add(bracket);
  }

  return {
    group,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
