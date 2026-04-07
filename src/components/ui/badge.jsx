import { cva } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-slate-900 text-slate-50',
        info: 'border-transparent bg-sky-100 text-sky-800',
        warning: 'border-transparent bg-amber-100 text-amber-800',
        success: 'border-transparent bg-emerald-100 text-emerald-800',
        outline: 'text-slate-900 border-slate-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge }
