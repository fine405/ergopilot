import type { WorkstationConfiguration } from "@ergopilot/contracts";
import {
  ContactShadows,
  Grid,
  OrbitControls,
  RoundedBox,
} from "@react-three/drei";
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
  position: [5.4, 3.6, 6.4] as [number, number, number],
  fov: 40,
};
const pixelRatio: [number, number] = [1, 1.65];
const renderer = { antialias: true };
const gravity: [number, number, number] = [0, -9.81, 0];
const tabletopCollider: [number, number, number] = [1.7, 0.07, 0.8];
const floorCollider: [number, number, number] = [6, 0.05, 6];

interface WorkstationSceneProps {
  configuration: WorkstationConfiguration;
  previewConfiguration: WorkstationConfiguration | undefined;
  uncertain: boolean;
}

export function WorkstationScene({
  configuration,
  previewConfiguration,
  uncertain,
}: WorkstationSceneProps) {
  return (
    <Canvas
      aria-label="Interactive physics-enabled ergonomic workstation digital twin"
      camera={camera}
      dpr={pixelRatio}
      gl={renderer}
      shadows
    >
      <color attach="background" args={["#101714"]} />
      <fog attach="fog" args={["#101714", 8, 16]} />
      <ambientLight intensity={0.72} />
      <directionalLight
        castShadow
        intensity={2.4}
        position={[4.5, 7, 4]}
        shadow-mapSize-height={1_024}
        shadow-mapSize-width={1_024}
      />
      <directionalLight
        intensity={0.55}
        position={[-4, 3, -2]}
        color="#b7d8ff"
      />

      <Room />
      <Physics
        colliders={false}
        gravity={gravity}
        maxCcdSubsteps={4}
        timeStep={1 / 60}
      >
        <Desk
          configuration={configuration}
          previewConfiguration={previewConfiguration}
          uncertain={uncertain}
        />
        <DeskPayload initialDeskHeightMm={configuration.deskHeightMm} />
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={floorCollider} position={[0, -0.05, 0]} />
        </RigidBody>
      </Physics>
      <ErgonomicChair chair={configuration.chair} />
      {previewConfiguration && (
        <ErgonomicChair chair={previewConfiguration.chair} preview />
      )}
      <ContactShadows
        position={[0, 0.012, 0]}
        opacity={0.42}
        scale={10}
        blur={2.4}
        far={5}
      />
      <Grid
        args={[12, 12]}
        cellColor="#2a3c35"
        cellSize={0.5}
        cellThickness={0.35}
        fadeDistance={9}
        fadeStrength={1.8}
        position={[0, 0.006, 0]}
        sectionColor="#49655a"
        sectionSize={2}
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={4.2}
        maxDistance={10}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.08}
        target={[0, 1.25, 0.55]}
      />
    </Canvas>
  );
}

function Room() {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.07, 0]}>
        <boxGeometry args={[12, 0.12, 12]} />
        <meshStandardMaterial color="#202925" roughness={0.92} />
      </mesh>
      <mesh receiveShadow position={[0, 3, -4.2]}>
        <boxGeometry args={[12, 6, 0.12]} />
        <meshStandardMaterial color="#26332e" roughness={0.95} />
      </mesh>
      <mesh receiveShadow position={[-4.4, 3, 0]}>
        <boxGeometry args={[0.12, 6, 8.5]} />
        <meshStandardMaterial color="#1d2824" roughness={0.95} />
      </mesh>
      <mesh position={[-2.3, 2.55, -4.1]}>
        <planeGeometry args={[2.3, 1.45]} />
        <meshStandardMaterial
          color="#87a9aa"
          emissive="#284c55"
          emissiveIntensity={0.25}
        />
      </mesh>
      <mesh
        receiveShadow
        position={[0.3, 0.012, 1.45]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[3.2, 2.65]} />
        <meshStandardMaterial color="#273a34" roughness={0.98} />
      </mesh>
      <Plant position={[3.25, 0, -2.6]} />
    </group>
  );
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.28, 0.22, 0.58, 24]} />
        <meshStandardMaterial color="#8f745b" roughness={0.8} />
      </mesh>
      {[0, 0.9, 1.8, 2.7, 3.6].map((rotation, index) => (
        <mesh
          key={rotation}
          castShadow
          position={[
            Math.cos(rotation) * 0.22,
            0.82 + index * 0.12,
            Math.sin(rotation) * 0.22,
          ]}
          rotation={[0.2, rotation, -0.25]}
        >
          <sphereGeometry args={[0.13, 16, 10]} />
          <meshStandardMaterial
            color={index % 2 ? "#527d61" : "#426b52"}
            roughness={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

interface DeskProps {
  configuration: WorkstationConfiguration;
  previewConfiguration: WorkstationConfiguration | undefined;
  uncertain: boolean;
}

function Desk({ configuration, previewConfiguration, uncertain }: DeskProps) {
  const movingAssembly = useRef<RapierRigidBody>(null);
  const renderedHeight = useRef(sceneHeight(configuration.deskHeightMm));
  const initialPosition = useRef<[number, number, number]>([
    0,
    renderedHeight.current,
    0,
  ]).current;
  const lightColor = temperatureColor(configuration.light.colorTemperatureK);

  useFrame((_, delta) => {
    renderedHeight.current = MathUtils.damp(
      renderedHeight.current,
      sceneHeight(configuration.deskHeightMm),
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
    <group>
      <DeskFrame />
      <RigidBody
        ref={movingAssembly}
        type="kinematicPosition"
        colliders={false}
        friction={0.9}
        position={initialPosition}
      >
        <CuboidCollider args={tabletopCollider} />
        <RoundedBox
          args={[3.4, 0.14, 1.6]}
          radius={0.06}
          smoothness={4}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color={uncertain ? "#b97835" : "#c8aa82"}
            metalness={0.02}
            roughness={0.58}
          />
        </RoundedBox>
        <Monitor position={[-0.42, 0.7, -0.25]} />
        <Keyboard />
        <TaskLamp
          brightnessPercent={configuration.light.brightnessPercent}
          color={lightColor}
        />
      </RigidBody>

      {previewConfiguration && (
        <RoundedBox
          args={[3.44, 0.17, 1.64]}
          radius={0.06}
          smoothness={3}
          position={[0, sceneHeight(previewConfiguration.deskHeightMm), 0]}
        >
          <meshStandardMaterial
            color="#f2b94b"
            opacity={0.3}
            transparent
            wireframe
          />
        </RoundedBox>
      )}
    </group>
  );
}

function DeskFrame() {
  return (
    <group>
      {[-1.18, 1.18].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <RoundedBox
            args={[0.2, 0.12, 1.35]}
            radius={0.04}
            smoothness={3}
            castShadow
            position={[0, 0.07, 0]}
          >
            <meshStandardMaterial
              color="#262f2c"
              metalness={0.62}
              roughness={0.35}
            />
          </RoundedBox>
          <mesh castShadow position={[0, 0.71, 0]}>
            <boxGeometry args={[0.25, 1.28, 0.25]} />
            <meshStandardMaterial
              color="#38433f"
              metalness={0.66}
              roughness={0.32}
            />
          </mesh>
          <mesh castShadow position={[0, 1.18, 0]}>
            <boxGeometry args={[0.16, 1.4, 0.16]} />
            <meshStandardMaterial
              color="#5a6662"
              metalness={0.72}
              roughness={0.28}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Monitor({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.2, 0.25, 0.04, 32]} />
        <meshStandardMaterial color="#1d2422" metalness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.48, 18]} />
        <meshStandardMaterial color="#303936" metalness={0.76} />
      </mesh>
      <RoundedBox
        args={[1.42, 0.84, 0.09]}
        radius={0.05}
        smoothness={4}
        castShadow
        position={[0, 0.42, 0]}
        rotation={[0, -0.06, 0]}
      >
        <meshStandardMaterial
          color="#141918"
          metalness={0.42}
          roughness={0.42}
        />
      </RoundedBox>
      <mesh position={[0, 0.42, 0.051]} rotation={[0, -0.06, 0]}>
        <planeGeometry args={[1.3, 0.72]} />
        <meshStandardMaterial
          color="#78c6aa"
          emissive="#1f5846"
          emissiveIntensity={0.65}
        />
      </mesh>
    </group>
  );
}

function Keyboard() {
  return (
    <group position={[0.35, 0.1, 0.25]}>
      <RoundedBox
        args={[0.86, 0.045, 0.34]}
        radius={0.035}
        smoothness={3}
        castShadow
      >
        <meshStandardMaterial color="#232b29" roughness={0.64} />
      </RoundedBox>
      <mesh castShadow position={[0.72, 0.025, 0.04]}>
        <boxGeometry args={[0.22, 0.055, 0.32]} />
        <meshStandardMaterial color="#2f3936" roughness={0.7} />
      </mesh>
    </group>
  );
}

function TaskLamp({
  brightnessPercent,
  color,
}: {
  brightnessPercent: number;
  color: string;
}) {
  return (
    <group position={[1.18, 0.08, -0.42]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.19, 0.23, 0.05, 28]} />
        <meshStandardMaterial color="#2b3431" metalness={0.62} />
      </mesh>
      <mesh castShadow position={[0, 0.42, 0]} rotation={[0, 0, -0.18]}>
        <cylinderGeometry args={[0.025, 0.03, 0.82, 14]} />
        <meshStandardMaterial color="#46514d" metalness={0.7} />
      </mesh>
      <mesh castShadow position={[0.12, 0.78, 0]} rotation={[0, 0, -0.65]}>
        <coneGeometry args={[0.2, 0.32, 24, 1, true]} />
        <meshStandardMaterial color="#37413e" metalness={0.55} side={2} />
      </mesh>
      <pointLight
        color={color}
        distance={4.2}
        intensity={0.15 + (brightnessPercent / 100) * 3.2}
        position={[0.22, 0.68, 0.05]}
        castShadow
      />
      <mesh position={[0.22, 0.68, 0.05]}>
        <sphereGeometry args={[0.055, 16, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2}
        />
      </mesh>
    </group>
  );
}

function DeskPayload({ initialDeskHeightMm }: { initialDeskHeightMm: number }) {
  const initialPosition = useRef<[number, number, number]>([
    -1.25,
    sceneHeight(initialDeskHeightMm) + 0.22,
    0.38,
  ]).current;

  return (
    <RigidBody
      ccd
      colliders={false}
      position={initialPosition}
      restitution={0.18}
      friction={1}
      linearDamping={0.45}
      angularDamping={0.35}
    >
      <BallCollider args={[0.11]} />
      <mesh castShadow>
        <sphereGeometry args={[0.11, 24, 18]} />
        <meshStandardMaterial color="#e1a83d" roughness={0.68} />
      </mesh>
    </RigidBody>
  );
}

function ErgonomicChair({
  chair,
  preview = false,
}: {
  chair: WorkstationConfiguration["chair"];
  preview?: boolean;
}) {
  const seatY = chair.seatHeightMm / 500;
  const seatDepth = chair.seatDepthMm / 500;
  const seatOffset = -(chair.seatDepthMm - 450) / 1_000;
  const armX = chair.armrestWidthMm / 1_000;
  const armY = seatY + chair.armrestHeightMm / 500;
  const armZ = -chair.armrestDepthMm / 500;
  const backAngle = MathUtils.degToRad(chair.reclineAngleDeg - 90);
  const previewScale = preview ? 1.012 : 1;

  return (
    <group position={[0.32, 0, 2.25]} scale={previewScale}>
      <ChairBase preview={preview} seatY={seatY} />
      <group position={[0, seatY, seatOffset]}>
        <RoundedBox
          args={[1.08, 0.16, seatDepth]}
          radius={0.11}
          smoothness={5}
          castShadow={!preview}
          receiveShadow={!preview}
        >
          <ChairSurface preview={preview} color="#315c4d" roughness={0.78} />
        </RoundedBox>
        {!preview && (
          <RoundedBox
            args={[0.92, 0.035, seatDepth * 0.86]}
            radius={0.08}
            smoothness={4}
            position={[0, 0.095, -0.015]}
          >
            <meshStandardMaterial color="#497b68" roughness={0.9} />
          </RoundedBox>
        )}
      </group>

      <group position={[0, seatY + 0.01, 0.38]} rotation={[backAngle, 0, 0]}>
        <Backrest chair={chair} preview={preview} />
      </group>

      {[-1, 1].map((side) => (
        <group key={side} position={[side * armX, 0, armZ]}>
          <mesh castShadow={!preview} position={[0, (seatY + armY) / 2, 0]}>
            <cylinderGeometry args={[0.035, 0.045, armY - seatY, 14]} />
            <ChairSurface preview={preview} color="#343f3b" metalness={0.58} />
          </mesh>
          <RoundedBox
            args={[0.16, 0.085, 0.55]}
            radius={0.055}
            smoothness={4}
            castShadow={!preview}
            position={[0, armY, 0]}
            rotation={[0, MathUtils.degToRad(side * chair.armrestAngleDeg), 0]}
          >
            <ChairSurface preview={preview} color="#355c50" roughness={0.72} />
          </RoundedBox>
        </group>
      ))}

      <ReclineControl chair={chair} preview={preview} seatY={seatY} />
    </group>
  );
}

function ChairBase({ preview, seatY }: { preview: boolean; seatY: number }) {
  return (
    <group>
      <mesh castShadow={!preview} position={[0, seatY / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.085, seatY - 0.18, 20]} />
        <ChairSurface preview={preview} color="#303936" metalness={0.72} />
      </mesh>
      <mesh castShadow={!preview} position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.18, 20]} />
        <ChairSurface preview={preview} color="#242c2a" metalness={0.66} />
      </mesh>
      {[0, 1, 2, 3, 4].map((index) => {
        const angle = (index / 5) * Math.PI * 2;
        return (
          <group key={index} rotation={[0, angle, 0]}>
            <mesh
              castShadow={!preview}
              position={[0, 0.1, 0.37]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.035, 0.055, 0.68, 14]} />
              <ChairSurface
                preview={preview}
                color="#2a3330"
                metalness={0.62}
              />
            </mesh>
            <mesh
              castShadow={!preview}
              position={[0, 0.055, 0.7]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.055, 0.055, 0.08, 16]} />
              <ChairSurface
                preview={preview}
                color="#171d1b"
                roughness={0.55}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Backrest({
  chair,
  preview,
}: {
  chair: WorkstationConfiguration["chair"];
  preview: boolean;
}) {
  const lumbarDepth = 0.06 + (chair.lumbarSupportPercent / 100) * 0.18;
  const headrestY = 1.35 + chair.headrestHeightMm / 500;
  return (
    <group>
      <RoundedBox
        args={[1.05, 1.25, 0.12]}
        radius={0.15}
        smoothness={5}
        castShadow={!preview}
        position={[0, 0.67, 0]}
      >
        <ChairSurface preview={preview} color="#294d42" roughness={0.74} />
      </RoundedBox>
      {!preview && (
        <RoundedBox
          args={[0.85, 0.98, 0.035]}
          radius={0.13}
          smoothness={5}
          position={[0, 0.7, -0.075]}
        >
          <meshStandardMaterial color="#426d5e" roughness={0.94} />
        </RoundedBox>
      )}
      <RoundedBox
        args={[0.72, 0.32, lumbarDepth]}
        radius={0.08}
        smoothness={4}
        castShadow={!preview}
        position={[0, 0.42, -0.08 - lumbarDepth / 2]}
      >
        <ChairSurface preview={preview} color="#69b293" emissive="#183d31" />
      </RoundedBox>
      <group
        position={[0, headrestY, 0.05]}
        rotation={[MathUtils.degToRad(chair.headrestAngleDeg), 0, 0]}
      >
        <mesh castShadow={!preview} position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.4, 14]} />
          <ChairSurface preview={preview} color="#36413d" metalness={0.6} />
        </mesh>
        <RoundedBox
          args={[0.72, 0.3, 0.18]}
          radius={0.11}
          smoothness={5}
          castShadow={!preview}
        >
          <ChairSurface preview={preview} color="#345e50" roughness={0.72} />
        </RoundedBox>
      </group>
    </group>
  );
}

function ReclineControl({
  chair,
  preview,
  seatY,
}: {
  chair: WorkstationConfiguration["chair"];
  preview: boolean;
  seatY: number;
}) {
  const color = chair.reclineLocked ? "#70c39e" : "#d5a24c";
  return (
    <group position={[0.62, seatY - 0.12, 0.12]}>
      <mesh castShadow={!preview} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.105, 0.105, 0.08, 24]} />
        <ChairSurface preview={preview} color="#2c3532" metalness={0.52} />
      </mesh>
      <mesh position={[0, -0.046, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry
          args={[
            0.073,
            0.014,
            10,
            28,
            (chair.reclineResistancePercent / 100) * Math.PI * 2,
          ]}
        />
        <meshStandardMaterial
          color={preview ? "#f2b94b" : color}
          emissive={color}
          emissiveIntensity={0.35}
        />
      </mesh>
    </group>
  );
}

function ChairSurface({
  preview,
  color,
  roughness = 0.62,
  metalness = 0.08,
  emissive = "#000000",
}: {
  preview: boolean;
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
}) {
  return (
    <meshStandardMaterial
      color={preview ? "#f2b94b" : color}
      emissive={preview ? "#6b4107" : emissive}
      emissiveIntensity={preview ? 0.22 : 0.18}
      metalness={metalness}
      opacity={preview ? 0.3 : 1}
      roughness={roughness}
      transparent={preview}
      wireframe={preview}
    />
  );
}

function sceneHeight(heightMm: number) {
  return heightMm / 500;
}

function temperatureColor(temperatureK: number) {
  if (temperatureK <= 3_300) return "#ffd2a3";
  if (temperatureK >= 5_000) return "#dcecff";
  return "#fff0d3";
}
