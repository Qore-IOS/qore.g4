"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SwitchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onCheckedChange) {
        onCheckedChange(e.target.checked);
      }
      if (props.onChange) {
        props.onChange(e);
      }
    };

    return (
      <div className={cn("toggle-wrapper font-sans text-[0.75rem]", className)}>
        <style jsx>{`
          /* --- LIGHT MODE STYLES (Neumorphic) --- */
          .toggle-wrapper {
             display: flex;
             justify-content: center;
             align-items: center;
             position: relative;
             border-radius: .5em;
             padding: .125em;
             background-image: linear-gradient(to bottom, #d5d5d5, #e8e8e8);
             box-shadow: 0 1px 1px rgb(255 255 255 / .6);
          }
          :global(.dark) .toggle-wrapper {
             /* DARK MODE OVERRIDE (Glass) */
             background-image: none;
             background-color: rgba(255,255,255,0.05);
             border: 1px solid rgba(255,255,255,0.1);
             box-shadow: 0 0 10px rgba(0,0,0,0.5);
          }

          .toggle-container {
             display: flex;
             align-items: center;
             position: relative;
             border-radius: .375em;
             width: 3em;
             height: 1.5em;
             background-color: #e8e8e8;
             box-shadow: inset 0 0 .0625em .125em rgb(255 255 255 / .2), inset 0 .0625em .125em rgb(0 0 0 / .4);
             transition: background-color .4s linear;
          }
          :global(.dark) .toggle-container {
             background-color: rgba(0,0,0,0.5);
             box-shadow: inset 0 0 5px rgba(0,0,0,0.8);
          }

          .toggle-checkbox:checked + .toggle-container {
             background-color: #f3b519;
          }
          :global(.dark) .toggle-checkbox:checked + .toggle-container {
             background-color: #f3b519; /* Keep gold or change to neon green/blue */
             box-shadow: 0 0 15px #f3b519; /* Neon glow in dark mode */
          }

          .toggle-button {
             display: flex;
             justify-content: center;
             align-items: center;
             position: absolute;
             left: .0625em;
             border-radius: .3125em;
             width: 1.375em;
             height: 1.375em;
             background-color: #e8e8e8;
             box-shadow: inset 0 -.0625em .0625em .125em rgb(0 0 0 / .1), inset 0 -.125em .0625em rgb(0 0 0 / .2), inset 0 .1875em .0625em rgb(255 255 255 / .3), 0 .125em .125em rgb(0 0 0 / .5);
             transition: left .4s;
          }
          :global(.dark) .toggle-button {
             background-color: #333;
             box-shadow: none;
             border: 1px solid rgba(255,255,255,0.2);
          }
          
          .toggle-checkbox {
             appearance: none;
             position: absolute;
             z-index: 1;
             border-radius: inherit;
             width: 100%;
             height: 100%;
             opacity: 0;
             cursor: pointer;
          }
          
          .toggle-checkbox:checked + .toggle-container > .toggle-button {
             left: 1.5625em;
          }
          .toggle-button-circles-container {
             display: grid;
             grid-template-columns: repeat(3, min-content);
             gap: .125em;
          }
          :global(.dark) .toggle-button-circles-container {
            display: none;
          }
          .toggle-button-circle {
             border-radius: 50%;
             width: .125em;
             height: .125em;
             background-image: radial-gradient(circle at 50% 0, #f5f5f5, #c4c4c4);
          }
        `}</style>

        <input 
          type="checkbox" 
          className="toggle-checkbox" 
          checked={checked}
          onChange={handleChange}
          ref={ref}
          {...props}
        />
        <div className="toggle-container">
          <div className="toggle-button">
             <div className="toggle-button-circles-container">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="toggle-button-circle"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
