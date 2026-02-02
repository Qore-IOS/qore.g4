"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

interface ThemeToggleDockProps {
  className?: string
}

export function ThemeToggleDock({ className }: ThemeToggleDockProps) {
  const { theme, setTheme } = useTheme()
  const { setUserTheme, currentUser, currentUserProfile } = useAuth()
  const [mounted, setMounted] = React.useState(false)

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true)
  }, [])

  // Force dark mode for 'user' role and hide the toggle
  React.useEffect(() => {
    if (mounted && currentUserProfile?.role === 'user' && theme !== 'dark') {
      setTheme('dark')
    }
  }, [mounted, currentUserProfile?.role, theme, setTheme])

  // Don't render toggle for 'user' role - they're forced to dark mode
  if (!mounted) return null
  if (currentUserProfile?.role === 'user') return null

  const isDark = theme === "dark"

  const toggleTheme = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTheme = e.target.checked ? "dark" : "light"
    setUserTheme(newTheme)
  }

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <label className="theme-switch">
        <input 
          type="checkbox" 
          className="theme-switch__checkbox" 
          checked={isDark}
          onChange={toggleTheme}
        />
        <div className="theme-switch__container">
          <div className="theme-switch__clouds"></div>
          <div className="theme-switch__stars-container">
            <div className="theme-switch__stars-cluster">
              <div className="star"></div>
              <div className="star"></div>
              <div className="star"></div>
              <div className="star"></div>
              <div className="star"></div>
            </div>
            <div className="theme-switch__aurora"></div>
            <div className="theme-switch__comets">
              <div className="comet"></div>
              <div className="comet"></div>
            </div>
          </div>
          <div className="theme-switch__circle-container">
            <div className="theme-switch__sun-moon-container">
              <div className="theme-switch__moon">
                <div className="theme-switch__spot"></div>
                <div className="theme-switch__spot"></div>
                <div className="theme-switch__spot"></div>
              </div>
            </div>
          </div>
          {/* Shooting stars elements */}
          <div className="theme-switch__shooting-star"></div>
          <div className="theme-switch__shooting-star-2"></div>
          <div className="theme-switch__meteor"></div>
        </div>
      </label>

      <style jsx>{`
        .theme-switch {
          --toggle-size: 12px; /* SCALED DOWN FOR DOCK (Original was 30px) */
          --container-width: 5.625em;
          --container-height: 2.5em;
          --container-radius: 6.25em;
          --container-light-bg: #3d7eae;
          --container-night-bg: #1d1f2c;
          --circle-container-diameter: 3.375em;
          --sun-moon-diameter: 2.125em;
          --sun-bg: #ecca2f;
          --moon-bg: #c4c9d1;
          --spot-color: #959db1;
          --circle-container-offset: calc((var(--circle-container-diameter) - var(--container-height)) / 2 * -1);
          --stars-color: #fff;
          --clouds-color: #f3fdff;
          --back-clouds-color: #aacadf;
          --transition: 0.5s cubic-bezier(0, -0.02, 0.4, 1.25);
          --circle-transition: 0.3s cubic-bezier(0, -0.02, 0.35, 1.17);
        }

        .theme-switch, .theme-switch *, .theme-switch *::before, .theme-switch *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          font-size: var(--toggle-size);
        }

        .theme-switch__container {
          width: var(--container-width);
          height: var(--container-height);
          background-color: var(--container-light-bg);
          border-radius: var(--container-radius);
          overflow: hidden;
          cursor: pointer;
          box-shadow: 0em -0.062em 0.062em rgba(0, 0, 0, 0.25), 0em 0.062em 0.125em rgba(255, 255, 255, 0.94);
          transition: var(--transition);
          position: relative;
          background-image: linear-gradient(to bottom, var(--container-light-bg) 0%, #5490c0 100%);
        }

        .theme-switch__container::before {
          content: "";
          position: absolute;
          z-index: 1;
          inset: 0;
          box-shadow: 0em 0.05em 0.187em rgba(0, 0, 0, 0.25) inset, 0em 0.05em 0.187em rgba(0, 0, 0, 0.25) inset;
          border-radius: var(--container-radius);
        }

        .theme-switch__checkbox { display: none; }

        .theme-switch__circle-container {
          width: var(--circle-container-diameter);
          height: var(--circle-container-diameter);
          background-color: rgba(255, 255, 255, 0.1);
          position: absolute;
          left: var(--circle-container-offset);
          top: var(--circle-container-offset);
          border-radius: var(--container-radius);
          box-shadow: inset 0 0 0 3.375em rgba(255, 255, 255, 0.1), inset 0 0 0 3.375em rgba(255, 255, 255, 0.1), 0 0 0 0.625em rgba(255, 255, 255, 0.1), 0 0 0 1.25em rgba(255, 255, 255, 0.1);
          display: flex;
          transition: var(--circle-transition);
          pointer-events: none;
        }

        .theme-switch__sun-moon-container {
          pointer-events: auto;
          position: relative;
          z-index: 2;
          width: var(--sun-moon-diameter);
          height: var(--sun-moon-diameter);
          margin: auto;
          border-radius: var(--container-radius);
          background-color: var(--sun-bg);
          box-shadow: 0.062em 0.062em 0.062em 0em rgba(254, 255, 239, 0.61) inset, 0em -0.062em 0.062em 0em #a1872a inset;
          filter: drop-shadow(0.062em 0.125em 0.125em rgba(0, 0, 0, 0.25)) drop-shadow(0em 0.062em 0.125em rgba(0, 0, 0, 0.25));
          overflow: hidden;
          transition: var(--transition);
          transform: scale(1);
        }

        .theme-switch__sun-moon-container:hover { transform: scale(1.1) rotate(5deg); }

        .theme-switch__moon {
          transform: translateX(100%);
          width: 100%;
          height: 100%;
          background-color: var(--moon-bg);
          border-radius: inherit;
          box-shadow: 0.062em 0.062em 0.062em 0em rgba(254, 255, 239, 0.61) inset, 0em -0.062em 0.062em 0em #969696 inset;
          transition: var(--transition);
          position: relative;
        }

        .theme-switch__moon:hover { transform: rotate(15deg); }

        .theme-switch__spot {
          position: absolute;
          top: 0.75em;
          left: 0.312em;
          width: 0.75em;
          height: 0.75em;
          border-radius: var(--container-radius);
          background-color: var(--spot-color);
          box-shadow: 0em 0.0312em 0.062em rgba(0, 0, 0, 0.25) inset;
          transition: background-color 0.3s ease;
        }
        .theme-switch__spot:nth-of-type(2) { width: 0.375em; height: 0.375em; top: 0.937em; left: 1.375em; }
        .theme-switch__spot:nth-last-of-type(3) { width: 0.25em; height: 0.25em; top: 0.312em; left: 0.812em; }
        .theme-switch__moon:hover .theme-switch__spot { background-color: #7a7f8c; }

        .theme-switch__clouds {
          width: 1.25em;
          height: 1.25em;
          background-color: var(--clouds-color);
          border-radius: var(--container-radius);
          position: absolute;
          bottom: -0.625em;
          left: 0.312em;
          box-shadow: 0.937em 0.312em var(--clouds-color), -0.312em -0.312em var(--back-clouds-color), 1.437em 0.375em var(--clouds-color), 0.5em -0.125em var(--back-clouds-color), 2.187em 0 var(--clouds-color), 1.25em -0.062em var(--back-clouds-color), 2.937em 0.312em var(--clouds-color), 2em -0.312em var(--back-clouds-color), 3.625em -0.062em var(--clouds-color), 2.625em 0em var(--back-clouds-color), 4.5em -0.312em var(--clouds-color), 3.375em -0.437em var(--back-clouds-color), 4.625em -1.75em 0 0.437em var(--clouds-color), 4em -0.625em var(--back-clouds-color), 4.125em -2.125em 0 0.437em var(--back-clouds-color);
          transition: 0.5s cubic-bezier(0, -0.02, 0.4, 1.25);
        }

        .theme-switch__stars-container {
          position: absolute;
          color: var(--stars-color);
          top: -100%;
          left: 0.312em;
          width: 2.75em;
          height: auto;
          transition: var(--transition);
        }

        .theme-switch__checkbox:checked + .theme-switch__container {
          background-color: var(--container-night-bg);
          background-image: linear-gradient(to bottom, var(--container-night-bg) 0%, #2d3142 100%);
        }

        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__circle-container {
          left: calc(100% - var(--circle-container-offset) - var(--circle-container-diameter));
        }

        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__circle-container:hover {
          left: calc(100% - var(--circle-container-offset) - var(--circle-container-diameter) - 0.187em);
        }

        .theme-switch__circle-container:hover { left: calc(var(--circle-container-offset) + 0.187em); }

        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__moon { transform: translate(0); }
        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__clouds { bottom: -4.062em; }
        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__stars-container { top: 50%; transform: translateY(-50%); }
        .theme-switch__container:hover .theme-switch__clouds { transform: translateX(15px) scale(1.02); }

        .theme-switch__sun-moon-container::after {
          content: ""; position: absolute; inset: -5px; background: radial-gradient(circle, rgba(255, 255, 255, 0.2) 0%, transparent 70%); border-radius: 50%; opacity: 0; transition: opacity 0.3s ease;
        }
        .theme-switch__sun-moon-container:hover::after { opacity: 1; }

        .theme-switch__shooting-star { position: absolute; width: 2px; height: 2px; background: white; top: 20%; left: -10%; opacity: 0; transition: opacity 0.3s ease; }
        .theme-switch__shooting-star-2 { position: absolute; width: 1px; height: 1px; background: white; top: 35%; left: -10%; opacity: 0; transition: opacity 0.3s ease; }
        .theme-switch__meteor { position: absolute; width: 3px; height: 3px; background: #ffd700; border-radius: 50%; top: -10%; left: 50%; opacity: 0; filter: blur(1px); transition: opacity 0.3s ease; }

        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__shooting-star { animation: shootingStar 2s linear infinite; opacity: 1; }
        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__shooting-star-2 { animation: shootingStar 3s linear infinite 1s; opacity: 1; }
        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__meteor { animation: meteor 4s linear infinite 2s; opacity: 1; }

        @keyframes shootingStar { 0% { transform: translateX(0) translateY(0) rotate(45deg); opacity: 1; } 100% { transform: translateX(150px) translateY(150px) rotate(45deg); opacity: 0; } }
        @keyframes meteor { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(150px) scale(0.3); opacity: 0; } }

        .theme-switch__stars-cluster { position: absolute; inset: 0; opacity: 0; transition: opacity 0.3s ease; }
        .theme-switch__stars-cluster .star { position: absolute; width: 2px; height: 2px; background: white; border-radius: 50%; box-shadow: 0 0 4px 1px white; }
        .theme-switch__stars-cluster .star:nth-child(1) { top: 20%; left: 20%; animation: twinkle 1s infinite ease-in-out; }
        .theme-switch__stars-cluster .star:nth-child(2) { top: 30%; left: 55%; animation: twinkle 1s infinite ease-in-out 0.3s; }
        .theme-switch__stars-cluster .star:nth-child(3) { top: 40%; left: 80%; animation: twinkle 1s infinite ease-in-out 0.6s; }
        .theme-switch__stars-cluster .star:nth-child(4) { top: 60%; left: 30%; animation: twinkle 1s infinite ease-in-out 0.9s; }
        .theme-switch__stars-cluster .star:nth-child(5) { top: 70%; left: 65%; animation: twinkle 1s infinite ease-in-out 1.2s; }

        .theme-switch__aurora { position: absolute; top: 0; left: 0; right: 0; height: 20px; background: linear-gradient(90deg, rgba(0, 255, 255, 0) 0%, rgba(0, 255, 255, 0.2) 25%, rgba(128, 0, 255, 0.2) 50%, rgba(0, 255, 255, 0.2) 75%, rgba(0, 255, 255, 0) 100%); opacity: 0; filter: blur(4px); transform: translateY(-100%); transition: opacity 0.3s ease; }

        .theme-switch__comets { position: absolute; inset: 0; overflow: hidden; opacity: 0; transition: opacity 0.3s ease; }
        .theme-switch__comets .comet { position: absolute; width: 2px; height: 2px; background: linear-gradient(90deg, white 0%, transparent 90%); border-radius: 50%; filter: blur(1px); }
        .theme-switch__comets .comet:nth-child(1) { top: 30%; left: -10%; animation: cometMove 4s linear infinite; }
        .theme-switch__comets .comet:nth-child(2) { top: 50%; left: -10%; animation: cometMove 6s linear infinite 2s; }

        @keyframes twinkle { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.2); } }
        @keyframes cometMove { 0% { transform: translateX(0) translateY(0) rotate(-45deg) scale(1); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateX(200px) translateY(200px) rotate(-45deg); opacity: 0; } }

        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__stars-cluster { opacity: 1; }
        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__aurora { opacity: 1; animation: auroraWave 8s linear infinite; }
        .theme-switch__checkbox:checked + .theme-switch__container .theme-switch__comets { opacity: 1; }

        @keyframes auroraWave { 0% { transform: translateY(-100%) translateX(-50%); } 100% { transform: translateY(-100%) translateX(50%); } }
      `}</style>
    </div>
  )
}
