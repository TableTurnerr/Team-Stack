'use client'

import { useMemo, useEffect, useRef, useCallback } from 'react'
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { shaderMaterial, useTrailTexture } from '@react-three/drei'
import { useTheme } from 'next-themes'
import * as THREE from 'three'

const DotMaterial = shaderMaterial(
    {
        time: 0,
        resolution: new THREE.Vector2(),
        dotColor: new THREE.Color('#FFFFFF'),
        bgColor: new THREE.Color('#121212'),
        mouseTrail: null,
        mousePos: new THREE.Vector2(-1, -1),
        render: 0,
        rotation: 0,
        gridSize: 50,
        dotOpacity: 0.05
    },
  /* glsl */ `
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  /* glsl */ `
    uniform float time;
    uniform int render;
    uniform vec2 resolution;
    uniform vec3 dotColor;
    uniform vec3 bgColor;
    uniform sampler2D mouseTrail;
    uniform vec2 mousePos;
    uniform float rotation;
    uniform float gridSize;
    uniform float dotOpacity;

    vec2 rotate(vec2 uv, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        mat2 rotationMatrix = mat2(c, -s, s, c);
        return rotationMatrix * (uv - 0.5) + 0.5;
    }

    vec2 coverUv(vec2 uv) {
      vec2 s = resolution.xy / max(resolution.x, resolution.y);
      vec2 newUv = (uv - 0.5) * s + 0.5;
      return clamp(newUv, 0.0, 1.0);
    }

    float sdfCircle(vec2 p, float r) {
        return length(p - 0.5) - r;
    }

    void main() {
      vec2 screenUv = gl_FragCoord.xy / resolution;
      vec2 uv = coverUv(screenUv);

      vec2 rotatedUv = rotate(uv, rotation);

      // Create a grid
      vec2 gridUv = fract(rotatedUv * gridSize);
      vec2 gridUvCenterInScreenCoords = rotate((floor(rotatedUv * gridSize) + 0.5) / gridSize, -rotation);

      // Distance from center for gradient
      vec2 center = vec2(0.5, 0.5);
      float distFromCenter = length(uv - center);

      // Mouse trail effect (fading)
      float mouseInfluence = texture2D(mouseTrail, gridUvCenterInScreenCoords).r;
      
      // Persistent cursor glow - use screenUv for correct mapping
      float distFromMouse = length(screenUv - mousePos);
      float cursorGlow = smoothstep(0.15, 0.0, distFromMouse) * 2.5;
      
      float scaleInfluence = max(mouseInfluence * 0.5, cursorGlow * 0.4);

      // Enhanced gradient - dots smaller and dimmer at corners, larger/brighter towards center
      float gradientFactor = 0.7 + (1.0 - distFromCenter) * 0.5;
      float dotSize = 0.12 * gradientFactor;

      float sdfDot = sdfCircle(gridUv, dotSize * (1.0 + scaleInfluence * 0.5));

      float smoothDot = smoothstep(0.05, 0.0, sdfDot);

      // Combine all influences with reduced base opacity and gradient
      float gradientOpacity = 0.6 + (1.0 - distFromCenter) * 0.5;
      float opacityInfluence = 0.3 + cursorGlow + mouseInfluence * 15.0;

      // Mix background color with dot color
      vec3 composition = mix(bgColor, dotColor, smoothDot * dotOpacity * gradientOpacity * (1.0 + opacityInfluence));

      gl_FragColor = vec4(composition, 1.0);

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
)

function Scene({ mousePos }: { mousePos: React.RefObject<THREE.Vector2 | null> }) {
    const size = useThree((s) => s.size)
    const viewport = useThree((s) => s.viewport)
    const { theme } = useTheme()

    const rotation = 0
    const gridSize = 100

    const getThemeColors = () => {
        switch (theme) {
            case 'dark':
                return {
                    dotColor: '#FFFFFF',
                    bgColor: '#121212',
                    dotOpacity: 0.01
                }
            case 'light':
                return {
                    dotColor: '#d0d0d0',
                    bgColor: '#F4F5F5',
                    dotOpacity: 0.06
                }
            default:
                return {
                    dotColor: '#FFFFFF',
                    bgColor: '#121212',
                    dotOpacity: 0.02
                }
        }
    }

    const themeColors = getThemeColors()

    const [trail, onMove] = useTrailTexture({
        size: 512,
        radius: 0.1,
        maxAge: 400,
        interpolate: 1,
        ease: function easeInOutCirc(x: number) {
            return x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2
        }
    })

    const dotMaterial = useMemo(() => {
        return new DotMaterial()
    }, [])

    useEffect(() => {
        dotMaterial.uniforms.dotColor.value.setHex(parseInt(themeColors.dotColor.replace('#', ''), 16))
        dotMaterial.uniforms.bgColor.value.setHex(parseInt(themeColors.bgColor.replace('#', ''), 16))
        dotMaterial.uniforms.dotOpacity.value = themeColors.dotOpacity
    }, [theme, dotMaterial, themeColors])

    useFrame((state) => {
        dotMaterial.uniforms.time.value = state.clock.elapsedTime
        if (mousePos.current) {
            dotMaterial.uniforms.mousePos.value.copy(mousePos.current)
        }
    })

    const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
        onMove(e)
    }

    const scale = Math.max(viewport.width, viewport.height) / 2

    return (
        <mesh
            scale={[scale, scale, 1]}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerMove}
            onPointerEnter={handlePointerMove}
        >
            <planeGeometry args={[2, 2]} />
            <primitive
                object={dotMaterial}
                resolution={[size.width * viewport.dpr, size.height * viewport.dpr]}
                rotation={rotation}
                gridSize={gridSize}
                mouseTrail={trail}
                render={0}
            />
        </mesh>
    )
}

export const DotScreenShader = () => {
    const containerRef = useRef<HTMLDivElement>(null)
    const mousePosRef = useRef<THREE.Vector2 | null>(new THREE.Vector2(-1, -1))

    const handleMouseMove = useCallback((e: MouseEvent | TouchEvent) => {
        if (!containerRef.current || !mousePosRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        let clientX: number, clientY: number

        if ('touches' in e && e.touches.length > 0) {
            clientX = e.touches[0].clientX
            clientY = e.touches[0].clientY
        } else if ('clientX' in e) {
            clientX = e.clientX
            clientY = e.clientY
        } else {
            return
        }

        // Normalize to 0-1, with Y flipped (0 at bottom, 1 at top)
        const x = (clientX - rect.left) / rect.width
        const y = 1 - (clientY - rect.top) / rect.height

        mousePosRef.current.set(x, y)
    }, [])

    useEffect(() => {
        // Listen on window to track cursor even when outside the container
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('touchmove', handleMouseMove)
        window.addEventListener('touchstart', handleMouseMove)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('touchmove', handleMouseMove)
            window.removeEventListener('touchstart', handleMouseMove)
        }
    }, [handleMouseMove])

    return (
        <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
            <Canvas
                gl={{
                    antialias: true,
                    powerPreference: 'high-performance',
                    outputColorSpace: THREE.SRGBColorSpace,
                    toneMapping: THREE.NoToneMapping
                }}
            >
                <Scene mousePos={mousePosRef} />
            </Canvas>
        </div>
    )
}

export default DotScreenShader
