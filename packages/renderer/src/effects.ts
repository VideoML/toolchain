import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { RendererProvider } from "./context.js";
import type { EffectInstance, EffectMountContext } from "@videoml/stdlib/effects";
export { mountEffect as mountRendererEffect } from "@videoml/stdlib/effects";

/** Adapts an existing frame-context React component to the shared effect lifecycle. */
export function createReactEffect(Component:React.ComponentType<any>, props:Record<string,unknown> = {}, durationFrames = 1, options:{settleFrame?:(frame:number,root:HTMLElement)=>Promise<void>} = {}):EffectInstance {
  let root:Root | null = null;
  let host:HTMLElement;
  let context:EffectMountContext;
  return {
    mount(element, options) { host=element; context=options; root=createRoot(element); },
    async seek(frame) {
      if (!root) throw new Error("React effect is not mounted");
      flushSync(() => root!.render(React.createElement(RendererProvider, {frame, config:{...context,durationFrames}, children:React.createElement(Component, props)})));
      await options.settleFrame?.(frame,host);
      await document.fonts?.ready;
      await Promise.all(Array.from(host.querySelectorAll('img')).map(image => image.decode()));
    },
    dispose() { root?.unmount(); root=null; },
  };
}
