import {Send} from 'lucide-react'
export type PublicationPrompt = {label:string;target:'catalog'|'notice'}
type Props = {
 prompt:PublicationPrompt
 busy:boolean
 canPublish:boolean
 onDismiss:()=>void
 onConfirm:()=>void
}
export default function PublicationConfirmDialog({prompt,busy,canPublish,onDismiss,onConfirm}:Props){
 return <div className="ops-publish-scrim" role="presentation">
  <section className="ops-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="ops-publish-heading" aria-describedby="ops-publish-description">
   <div className="ops-publish-symbol"><Send size={23} aria-hidden="true"/></div>
   <h2 id="ops-publish-heading">¿Deseas publicar los cambios ahora?</h2>
   <p id="ops-publish-description">Se guardaron los cambios de {prompt.label}.
    {prompt.target==='notice'
     ?' Los avisos comerciales se publican desde su propio módulo y no con el catálogo de Android.'
     :canPublish
      ?' Si confirmas, se actualizará el catálogo público de la aplicación.'
      :' Para publicar tendrás que seleccionar o registrar la aplicación correspondiente.'}
   </p>
   <div className="ops-publish-dialog-actions">
    <button type="button" className="button button-secondary" disabled={busy} onClick={onDismiss}>Ahora no</button>
    <button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>
     {busy?'Publicando…':prompt.target==='notice'||!canPublish?'Ir a publicar':'Sí, publicar ahora'}
    </button>
   </div>
  </section>
 </div>
}
