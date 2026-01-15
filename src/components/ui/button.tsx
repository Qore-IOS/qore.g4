
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// REFACTOR: Light mode uses 'neu-btn-universal' + text colors.
// Dark mode uses Liquid Glass styling via CSS (globals.css)
// Mobile-optimized: responsive sizing and touch-friendly targets
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 neu-btn-universal touch-target",
  {
    variants: {
      variant: {
        // Dark mode styles handled by .dark .neu-btn-universal in globals.css
        default:
          "neu-text-primary dark:text-primary-foreground",
        destructive:
          "neu-text-destructive dark:text-destructive-foreground",
        outline:
          "dark:text-foreground",
        secondary:
          "dark:text-secondary-foreground",
        ghost: "dark:text-foreground dark:hover:bg-white/5",
        link: "text-primary underline-offset-4 hover:underline dark:text-primary",
      },
      size: {
        // Responsive sizes: mobile-first approach
        default: "h-9 sm:h-10 px-3 sm:px-4 py-2 text-xs sm:text-sm",
        sm: "h-8 sm:h-9 rounded-md px-2.5 sm:px-3 text-xs",
        lg: "h-10 sm:h-11 rounded-md px-6 sm:px-8 text-sm sm:text-base",
        icon: "h-9 w-9 sm:h-10 sm:w-10",
        // Mobile-specific: icon-only button that shows text on larger screens
        "icon-mobile": "h-9 w-9 sm:h-10 sm:w-auto sm:px-4 sm:py-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  // Hide text on mobile, show only icon
  mobileIconOnly?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, mobileIconOnly = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    // If mobileIconOnly, wrap text children to hide on mobile
    const processedChildren = mobileIconOnly ? (
      React.Children.map(children, (child) => {
        if (typeof child === 'string') {
          return <span className="hidden sm:inline">{child}</span>
        }
        if (React.isValidElement(child) && typeof child.type === 'function') {
          // Likely an icon component - keep visible
          return child
        }
        if (React.isValidElement(child) && child.type === 'span') {
          return React.cloneElement(child as React.ReactElement<any>, {
            className: cn((child.props as any).className, "hidden sm:inline")
          })
        }
        return child
      })
    ) : children

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          mobileIconOnly && "sm:w-auto"
        )}
        ref={ref}
        {...props}
      >
        {processedChildren}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
