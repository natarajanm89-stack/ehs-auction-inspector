import { useEffect, useState } from 'react'
import type { Machine } from '../types'

/**
 * Most lots in the catalogue have no image URL, and a bare <img src={undefined}>
 * renders as a broken-file icon on every card. Falls back to a labelled tile
 * showing the machine's own identity, which is more use in a yard than a
 * generic placeholder: the inspector is matching a card to a machine in front
 * of them, and lot number plus make is exactly what is painted on the machine.
 */
export function MachineImage({ machine, className }: { machine: Machine; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [machine.imageUrl])

  if (!machine.imageUrl || failed) {
    return (
      <div className={`machine-image-fallback ${className ?? ''}`} role="img"
           aria-label={`No catalogue photo for lot ${machine.lot}, ${machine.make} ${machine.model}`}>
        <span className="mif-lot">LOT {machine.lot}</span>
        <span className="mif-model">{machine.make} {machine.model}</span>
        <span className="mif-note">No catalogue photo</span>
      </div>
    )
  }

  return (
    <img className={className} src={machine.imageUrl} alt={machine.title}
         onError={() => setFailed(true)} />
  )
}
