import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  type RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { useRef } from "react";
import { MathUtils } from "three";

const camera = {
  position: [4.8, 3.2, 5.6] as [number, number, number],
  fov: 42,
};
const pixelRatio: [number, number] = [1, 1.75];
const renderer = { antialias: true };
const gravity: [number, number, number] = [0, -9.81, 0];
const tabletopCollider: [number, number, number] = [1.65, 0.07, 0.775];
const floorCollider: [number, number, number] = [6, 0.05, 6];
const floorPosition: [number, number, number] = [0, -0.05, 0];
const payloadCollider: [number] = [0.14];

interface WorkstationSceneProps {
  confirmedHeightMm: number;
  lumbarSupportPercent: number;
  previewHeightMm: number | undefined;
  previewLumbarSupportPercent: number | undefined;
  uncertain: boolean;
}

export function WorkstationScene({
  confirmedHeightMm,
  lumbarSupportPercent,
  previewHeightMm,
  previewLumbarSupportPercent,
  uncertain,
}: WorkstationSceneProps) {
  return (
    <Canvas
      aria-label="Interactive physics-enabled workstation digital twin"
      camera={camera}
      dpr={pixelRatio}
      gl={renderer}
    >
      <color attach="background" args={["#0d1512"]} />
      <fog attach="fog" args={["#0d1512", 7, 14]} />
      <ambientLight intensity={1.5} />
      <directionalLight castShadow intensity={3.2} position={[3.5, 6, 4]} />
      <directionalLight intensity={1.1} position={[-4, 2, -3]} />

      <Physics
        colliders={false}
        gravity={gravity}
        maxCcdSubsteps={4}
        timeStep={1 / 60}
      >
        <Desk
          confirmedHeightMm={confirmedHeightMm}
          previewHeightMm={previewHeightMm}
          uncertain={uncertain}
        />
        <DynamicPayload initialDeskHeightMm={confirmedHeightMm} />
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={floorCollider} position={floorPosition} />
        </RigidBody>
      </Physics>
      <Chair
        lumbarSupportPercent={lumbarSupportPercent}
        previewLumbarSupportPercent={previewLumbarSupportPercent}
      />
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
  const movingAssembly = useRef<RapierRigidBody>(null);
  const renderedHeight = useRef(sceneHeight(confirmedHeightMm));
  const initialPosition = useRef<[number, number, number]>([
    0,
    renderedHeight.current,
    0,
  ]).current;

  useFrame((_, delta) => {
    renderedHeight.current = MathUtils.damp(
      renderedHeight.current,
      sceneHeight(confirmedHeightMm),
      4.5,
      delta,
    );
    movingAssembly.current?.setNextKinematicTranslation({
      x: 0,
      y: renderedHeight.current,
      z: 0,
    });
  });

  return (
    <group position={[0, 0, 0]}>
      <DeskFeet />
      <RigidBody
        ref={movingAssembly}
        type="kinematicPosition"
        colliders={false}
        friction={0.9}
        position={initialPosition}
      >
        <CuboidCollider args={tabletopCollider} />
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
      </RigidBody>

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

function DynamicPayload({
  initialDeskHeightMm,
}: {
  initialDeskHeightMm: number;
}) {
  const initialPosition = useRef<[number, number, number]>([
    1.05,
    sceneHeight(initialDeskHeightMm) + 0.25,
    0.18,
  ]).current;

  return (
    <RigidBody
      ccd
      colliders={false}
      position={initialPosition}
      restitution={0.22}
      friction={1}
      linearDamping={0.35}
      angularDamping={0.25}
    >
      <BallCollider args={payloadCollider} />
      <mesh castShadow>
        <sphereGeometry args={[0.14, 24, 24]} />
        <meshStandardMaterial
          color="#f2b94b"
          emissive="#6b4107"
          emissiveIntensity={0.22}
          roughness={0.6}
        />
      </mesh>
    </RigidBody>
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

function Chair({
  lumbarSupportPercent,
  previewLumbarSupportPercent,
}: {
  lumbarSupportPercent: number;
  previewLumbarSupportPercent: number | undefined;
}) {
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
      <LumbarPad levelPercent={lumbarSupportPercent} />
      {previewLumbarSupportPercent !== undefined && (
        <LumbarPad levelPercent={previewLumbarSupportPercent} preview />
      )}
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

function LumbarPad({
  levelPercent,
  preview = false,
}: {
  levelPercent: number;
  preview?: boolean;
}) {
  const depth = 0.08 + (levelPercent / 100) * 0.2;

  return (
    <mesh castShadow={!preview} position={[0, 1.5, 0.24 - depth / 2]}>
      <boxGeometry args={[0.72, 0.34, depth]} />
      <meshStandardMaterial
        color={preview ? "#f2b94b" : "#78c6aa"}
        emissive={preview ? "#6b4107" : "#255e4b"}
        emissiveIntensity={preview ? 0.2 : 0.35}
        opacity={preview ? 0.42 : 1}
        transparent={preview}
        wireframe={preview}
      />
    </mesh>
  );
}

function sceneHeight(heightMm: number) {
  return heightMm / 500;
}
