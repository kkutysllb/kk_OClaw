"use client";

import { useEffect, useRef } from "react";

interface PlanetConfig {
  name: string;
  radius: number;       // planet radius in px
  orbitRadius: number;  // distance from sun
  speed: number;        // orbit speed
  color: string;
  glowColor: string;
  hasRing?: boolean;
  ringColor?: string;
  ringWidth?: number;
}

const PLANETS: PlanetConfig[] = [
  { name: "Mercury", radius: 2.5, orbitRadius: 55, speed: 4.15, color: "#b0b0b0", glowColor: "rgba(176,176,176,0.4)" },
  { name: "Venus",   radius: 5,   orbitRadius: 80, speed: 3.0,  color: "#e8cda0", glowColor: "rgba(232,205,160,0.4)" },
  { name: "Earth",   radius: 5.5, orbitRadius: 110, speed: 2.4,  color: "#4da6ff", glowColor: "rgba(77,166,255,0.5)" },
  { name: "Mars",    radius: 4,   orbitRadius: 145, speed: 1.8,  color: "#e0553d", glowColor: "rgba(224,85,61,0.4)" },
  { name: "Jupiter", radius: 14,  orbitRadius: 200, speed: 1.1,  color: "#d4a574", glowColor: "rgba(212,165,116,0.5)" },
  { name: "Saturn",  radius: 11,  orbitRadius: 260, speed: 0.85, color: "#e8d5a3", glowColor: "rgba(232,213,163,0.5)", hasRing: true, ringColor: "rgba(200,180,140,0.6)", ringWidth: 8 },
  { name: "Uranus",  radius: 8,   orbitRadius: 315, speed: 0.65, color: "#7ec8e3", glowColor: "rgba(126,200,227,0.45)" },
  { name: "Neptune", radius: 7.5, orbitRadius: 355, speed: 0.55, color: "#4169e1", glowColor: "rgba(65,105,225,0.45)" },
  { name: "Pluto",   radius: 2,   orbitRadius: 390, speed: 0.4,  color: "#c8c0b8", glowColor: "rgba(200,192,184,0.3)" },
];

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

interface FloatingParticle {
  x: number;
  y: number;
  radius: number;
  speedX: number;
  speedY: number;
  opacity: number;
  life: number;
  maxLife: number;
}

interface ShootingStar {
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
  opacity: number;
  life: number;
  maxLife: number;
  width: number;
}

interface Props {
  className?: string;
  starCount?: number;
  particleCount?: number;
}

export default function SolarSystem({
  className = "",
  starCount = 300,
  particleCount = 100,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let centerX = 0;
    let centerY = 0;
    let dpr = 1;

    const stars: Star[] = [];
    const particles: FloatingParticle[] = [];
    const shootingStars: ShootingStar[] = [];
    let time = 0;

    function spawnShootingStar() {
      const angle = Math.PI * 0.25 + Math.random() * Math.PI * 0.5; // mostly horizontal-ish
      const speed = 6 + Math.random() * 8;
      const startX = Math.random() * width * 0.3;
      const startY = Math.random() * height * 0.5;
      shootingStars.push({
        x: startX,
        y: startY,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        length: 60 + Math.random() * 100,
        opacity: 0.5 + Math.random() * 0.5,
        life: 0,
        maxLife: 30 + Math.random() * 40,
        width: 1 + Math.random() * 1.5,
      });
    }

    function initParticles() {
      particles.length = 0;
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 2.5 + 0.8,
          speedX: (Math.random() - 0.5) * 0.5,
          speedY: (Math.random() - 0.5) * 0.5,
          opacity: Math.random() * 0.6 + 0.3,
          life: Math.random() * 400,
          maxLife: 400 + Math.random() * 300,
        });
      }
    }

    function initStars() {
      stars.length = 0;
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 2.2 + 0.4,
          opacity: Math.random() * 0.7 + 0.3,
          twinkleSpeed: Math.random() * 0.04 + 0.01,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
    }

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      centerX = width / 2;
      centerY = height / 2;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      initStars();
      initParticles();
    }

    function drawSun() {
      const sunRadius = 28;

      // Outer glow layers - wider and more luminous
      for (let i = 5; i >= 0; i--) {
        const r = sunRadius + i * 14 + Math.sin(time * 0.003 + i) * 4;
        const alpha = 0.12 / (i + 1);
        const gradient = ctx!.createRadialGradient(centerX, centerY, sunRadius * 0.2, centerX, centerY, r);
        gradient.addColorStop(0, `rgba(255,220,80,${alpha * 4})`);
        gradient.addColorStop(0.4, `rgba(255,160,30,${alpha * 1.5})`);
        gradient.addColorStop(0.7, `rgba(255,100,20,${alpha})`);
        gradient.addColorStop(1, "rgba(255,60,10,0)");
        ctx!.beginPath();
        ctx!.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx!.fillStyle = gradient;
        ctx!.fill();
      }

      // Sun core - brighter
      const coreGrad = ctx!.createRadialGradient(centerX, centerY, 0, centerX, centerY, sunRadius);
      coreGrad.addColorStop(0, "#ffffff");
      coreGrad.addColorStop(0.2, "#fffde0");
      coreGrad.addColorStop(0.45, "#ffdd57");
      coreGrad.addColorStop(0.7, "#ff9933");
      coreGrad.addColorStop(1, "#ff5500");
      ctx!.beginPath();
      ctx!.arc(centerX, centerY, sunRadius, 0, Math.PI * 2);
      ctx!.fillStyle = coreGrad;
      ctx!.fill();

      // Corona pulse - more pronounced
      const pulseRadius = sunRadius + 8 + Math.sin(time * 0.005) * 6;
      ctx!.beginPath();
      ctx!.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(255,200,50,${0.25 + Math.sin(time * 0.004) * 0.08})`;
      ctx!.lineWidth = 1.5;
      ctx!.stroke();

      // Second corona ring
      const pulse2 = sunRadius + 16 + Math.cos(time * 0.003) * 5;
      ctx!.beginPath();
      ctx!.arc(centerX, centerY, pulse2, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(255,150,30,${0.1 + Math.cos(time * 0.006) * 0.05})`;
      ctx!.lineWidth = 0.8;
      ctx!.stroke();
    }

    function drawOrbit(radius: number) {
      ctx!.beginPath();
      ctx!.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx!.strokeStyle = "rgba(100,150,220,0.18)";
      ctx!.lineWidth = 0.7;
      ctx!.stroke();
    }

    function drawPlanet(planet: PlanetConfig, angle: number) {
      const x = centerX + Math.cos(angle) * planet.orbitRadius;
      const y = centerY + Math.sin(angle) * planet.orbitRadius;

      // Glow - more visible
      const glowGrad = ctx!.createRadialGradient(x, y, planet.radius * 0.4, x, y, planet.radius * 4);
      glowGrad.addColorStop(0, planet.glowColor);
      glowGrad.addColorStop(0.5, planet.glowColor.replace(/[\d.]+(?=\))/, (m) => String(Number(m) * 0.4)));
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.beginPath();
      ctx!.arc(x, y, planet.radius * 4, 0, Math.PI * 2);
      ctx!.fillStyle = glowGrad;
      ctx!.fill();

      // Ring (Saturn)
      if (planet.hasRing) {
        ctx!.save();
        ctx!.translate(x, y);
        ctx!.rotate(0.4); // slight tilt
        ctx!.beginPath();
        ctx!.ellipse(0, 0, planet.radius + planet.ringWidth!, planet.radius * 0.35 + (planet.ringWidth! * 0.15), 0, 0, Math.PI * 2);
        ctx!.strokeStyle = planet.ringColor!;
        ctx!.lineWidth = 2.5;
        ctx!.stroke();

        // Inner ring highlight
        ctx!.beginPath();
        ctx!.ellipse(0, 0, planet.radius + planet.ringWidth! * 0.4, planet.radius * 0.25, 0, 0, Math.PI * 2);
        ctx!.strokeStyle = "rgba(255,255,255,0.25)";
        ctx!.lineWidth = 0.8;
        ctx!.stroke();
        ctx!.restore();
      }

      // Planet body
      const bodyGrad = ctx!.createRadialGradient(
        x - planet.radius * 0.25,
        y - planet.radius * 0.25,
        planet.radius * 0.1,
        x,
        y,
        planet.radius
      );
      bodyGrad.addColorStop(0, "#ffffff");
      bodyGrad.addColorStop(0.4, planet.color);
      bodyGrad.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx!.beginPath();
      ctx!.arc(x, y, planet.radius, 0, Math.PI * 2);
      ctx!.fillStyle = bodyGrad;
      ctx!.fill();

      // Orbital trail dot - more visible
      const trailCount = 4;
      for (let i = 1; i <= trailCount; i++) {
        const trailAngle = angle - i * 0.05;
        const trailX = centerX + Math.cos(trailAngle) * planet.orbitRadius;
        const trailY = centerY + Math.sin(trailAngle) * planet.orbitRadius;
        ctx!.beginPath();
        ctx!.arc(trailX, trailY, planet.radius * 0.5, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(120,180,255,${0.12 / i})`;
        ctx!.fill();
      }
    }

    function drawStars() {
      for (const star of stars) {
        const twinkle = Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.3 + 0.7;
        const alpha = star.opacity * twinkle;
        ctx!.beginPath();
        ctx!.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx!.fill();

        // Cross sparkle for bright stars
        if (star.radius > 1 && twinkle > 0.85) {
          ctx!.strokeStyle = `rgba(200,220,255,${alpha * 0.5})`;
          ctx!.lineWidth = 0.3;
          ctx!.beginPath();
          ctx!.moveTo(star.x - star.radius * 2.5, star.y);
          ctx!.lineTo(star.x + star.radius * 2.5, star.y);
          ctx!.moveTo(star.x, star.y - star.radius * 2.5);
          ctx!.lineTo(star.x, star.y + star.radius * 2.5);
          ctx!.stroke();
        }
      }
    }

    function drawParticles() {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.x += p.speedX;
        p.y += p.speedY;
        p.life--;

        if (p.life <= 0) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
          p.speedX = (Math.random() - 0.5) * 0.5;
          p.speedY = (Math.random() - 0.5) * 0.5;
          p.life = p.maxLife;
        }

        const alpha = p.opacity * Math.min(p.life / 30, 1) * (p.life > p.maxLife - 30 ? (p.maxLife - p.life) / 30 : 1);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(150,200,255,${alpha})`;
        ctx!.fill();
      }
    }

    function drawShootingStars() {
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const s = shootingStars[i]!;
        s.x += s.dx;
        s.y += s.dy;
        s.life++;

        if (s.life > s.maxLife || s.x > width + 100 || s.y > height + 100) {
          shootingStars.splice(i, 1);
          continue;
        }

        const progress = s.life / s.maxLife;
        const alpha = s.opacity * (1 - progress) * Math.sin(progress * Math.PI);

        // Trail gradient
        const startX = s.x - s.dx * s.length / 10;
        const startY = s.y - s.dy * s.length / 10;
        const grad = ctx!.createLinearGradient(startX, startY, s.x, s.y);
        grad.addColorStop(0, `rgba(255,255,255,0)`);
        grad.addColorStop(0.3, `rgba(180,220,255,${alpha * 0.5})`);
        grad.addColorStop(1, `rgba(255,255,255,${alpha})`);

        ctx!.beginPath();
        ctx!.moveTo(startX, startY);
        ctx!.lineTo(s.x, s.y);
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = s.width;
        ctx!.lineCap = "round";
        ctx!.stroke();
      }
    }

    function drawGridLines() {
      // Thin subtle grid overlay - slightly more visible
      ctx!.strokeStyle = "rgba(50,80,140,0.06)";
      ctx!.lineWidth = 0.5;
      const gridSize = 80;
      for (let x = gridSize; x < width; x += gridSize) {
        ctx!.beginPath();
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, height);
        ctx!.stroke();
      }
      for (let y = gridSize; y < height; y += gridSize) {
        ctx!.beginPath();
        ctx!.moveTo(0, y);
        ctx!.lineTo(width, y);
        ctx!.stroke();
      }
    }

    function animate() {
      time++;
      ctx!.clearRect(0, 0, width, height);

      // Background gradient
      const bgGrad = ctx!.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.7);
      bgGrad.addColorStop(0, "#0a0d1a");
      bgGrad.addColorStop(1, "#03050a");
      ctx!.fillStyle = bgGrad;
      ctx!.fillRect(0, 0, width, height);

      drawGridLines();
      drawStars();
      drawParticles();

      // Spawn shooting stars periodically
      if (time % 40 === 0 && shootingStars.length < 3) {
        spawnShootingStar();
      }
      drawShootingStars();

      // Draw all orbits
      for (const planet of PLANETS) {
        drawOrbit(planet.orbitRadius);
      }

      // Draw planets - faster orbit speed
      for (const planet of PLANETS) {
        const angle = (time * 0.003 * planet.speed) % (Math.PI * 2);
        drawPlanet(planet, angle);
      }

      // Draw sun on top
      drawSun();

      // Nebula overlay - more dramatic and colorful
      const nebulaGrad = ctx!.createRadialGradient(centerX, centerY, 80, centerX, centerY, Math.max(width, height) * 0.6);
      nebulaGrad.addColorStop(0, "rgba(30,20,60,0)");
      nebulaGrad.addColorStop(0.25, "rgba(40,20,80,0.06)");
      nebulaGrad.addColorStop(0.5, "rgba(20,15,50,0.1)");
      nebulaGrad.addColorStop(0.75, "rgba(10,10,30,0.15)");
      nebulaGrad.addColorStop(1, "rgba(5,5,15,0.2)");
      ctx!.fillStyle = nebulaGrad;
      ctx!.fillRect(0, 0, width, height);

      animRef.current = requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize);
    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [starCount, particleCount]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 size-full ${className}`}
    />
  );
}
