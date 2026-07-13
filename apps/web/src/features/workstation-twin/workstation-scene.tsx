import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { type Group, MathUtils } from "three";

const camera = {
  position: [4.8, 3.2, 5.6] as [number, number, number],
  fov: 42,
};
const pixelRatio: [number, number] = [1, 1.75];
const renderer = { antialias: true };

interface WorkstationSceneProps {
  confirmedHeightMm: number;
  previewHeightMm: number | undefined;
  uncertain: boolean;
}

export function WorkstationScene({
  confirmedHeightMm,
  previewHeightMm,
  uncertain,
}: WorkstationSceneProps) {
  return (
    <Canvas
      aria-label="Interactive 3D workstation digital twin"
      camera={camera}
      dpr={pixelRatio}
      gl={renderer}
    >
      <color attach="background" args={["#0d1512"]} />
      <fog attach="fog" args={["#0d1512", 7, 14]} />
      <ambientLight intensity={1.5} />
      <directionalLight castShadow intensity={3.2} position={[3.5, 6, 4]} />
      <directionalLight intensity={1.1} position={[-4, 2, -3]} />

      <Desk
        confirmedHeightMm={confirmedHeightMm}
        previewHeightMm={previewHeightMm}
        uncertain={uncertain}
      />
      <Chair />
      <Grid
        args={[12, 12]}
        cellColor="#294239"
        cellSize={0.25}
        cellThickness={0.55}
        fadeDistance={8}
        fadeStrength={1.5}
        position={[0, 0, 0]}
        sectionColor="#446b5d"
        sectionSize={1}
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={4}
        maxDistance={9}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 1.25, 0]}
      />
    </Canvas>
  );
}

interface DeskProps {
  confirmedHeightMm: number;
  previewHeightMm: number | undefined;
  uncertain: boolean;
}

function Desk({ confirmedHeightMm, previewHeightMm, uncertain }: DeskProps) {
  const movingAssembly = useRef<Group>(null);
  const renderedHeight = useRef(sceneHeight(confirmedHeightMm));

  useFrame((_, delta) => {
    renderedHeight.current = MathUtils.damp(
      renderedHeight.current,
      sceneHeight(confirmedHeightMm),
      4.5,
      delta,
    );
    if (movingAssembly.current) {
      movingAssembly.current.position.y = renderedHeight.current;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      <DeskFeet />
      <group ref={movingAssembly} position={[0, renderedHeight.current, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[3.3, 0.14, 1.55]} />
          <meshStandardMaterial
            color={uncertain ? "#d89432" : "#d7c8aa"}
            metalness={0.05}
            roughness={0.52}
          />
        </mesh>
        <Monitor position={[-0.45, 0.72, -0.28]} />
        <mesh castShadow position={[0.78, 0.09, 0.13]}>
          <boxGeometry args={[0.64, 0.035, 0.28]} />
          <meshStandardMaterial color="#242b29" roughness={0.6} />
        </mesh>
      </group>

      {previewHeightMm !== undefined && (
        <mesh position={[0, sceneHeight(previewHeightMm), 0]}>
          <boxGeometry args={[3.34, 0.16, 1.59]} />
          <meshStandardMaterial
            color="#f2b94b"
            opacity={0.28}
            transparent
            wireframe
          />
        </mesh>
      )}
    </group>
  );
}

function DeskFeet() {
  return (
    <group>
      {[-1.15, 1.15].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh castShadow position={[0, 0.08, 0]}>
            <boxGeometry args={[0.18, 0.16, 1.25]} />
            <meshStandardMaterial color="#29312f" metalness={0.65} />
          </mesh>
          <mesh castShadow position={[0, 1.08, 0]}>
            <boxGeometry args={[0.24, 2, 0.24]} />
            <meshStandardMaterial color="#414b48" metalness={0.72} />
          </mesh>
          <mesh castShadow position={[0, 1.42, 0]}>
            <boxGeometry args={[0.16, 1.6, 0.16]} />
            <meshStandardMaterial color="#66726e" metalness={0.78} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Monitor({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, -0.28, 0]}>
        <cylinderGeometry args={[0.2, 0.25, 0.04, 32]} />
        <meshStandardMaterial color="#202725" metalness={0.75} />
      </mesh>
      <mesh castShadow position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.055, 0.055, 0.46, 18]} />
        <meshStandardMaterial color="#343d3a" metalness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.36, 0]} rotation={[0, -0.08, 0]}>
        <boxGeometry args={[1.35, 0.78, 0.08]} />
        <meshStandardMaterial color="#151b1a" metalness={0.45} />
      </mesh>
      <mesh position={[0, 0.36, 0.046]} rotation={[0, -0.08, 0]}>
        <planeGeometry args={[1.24, 0.68]} />
        <meshStandardMaterial
          color="#78c6aa"
          emissive="#255e4b"
          emissiveIntensity={0.7}
        />
      </mesh>
    </group>
  );
}

function Chair() {
  return (
    <group position={[0.25, 0, 2.15]} rotation={[0, Math.PI, 0]}>
      <mesh castShadow position={[0, 0.92, 0]}>
        <boxGeometry args={[1.05, 0.14, 0.92]} />
        <meshStandardMaterial color="#365e50" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 1.65, 0.38]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[1.08, 1.25, 0.16]} />
        <meshStandardMaterial color="#2d5044" roughness={0.76} />
      </mesh>
      <mesh castShadow position={[0, 0.48, 0]}>
        <cylinderGeometry args={[0.075, 0.075, 0.8, 18]} />
        <meshStandardMaterial color="#28312f" metalness={0.65} />
      </mesh>
      <mesh castShadow position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.65, 0.65, 0.08, 5]} />
        <meshStandardMaterial color="#222a28" metalness={0.7} />
      </mesh>
    </group>
  );
}

function sceneHeight(heightMm: number) {
  return heightMm / 500;
}
