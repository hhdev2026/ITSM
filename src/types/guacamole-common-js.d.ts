declare module "guacamole-common-js" {
  export type Status = { code?: number; message?: string };

  export type MouseState = {
    x: number;
    y: number;
    left: boolean;
    middle: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
  };

  export class WebSocketTunnel {
    constructor(url: string);
  }

  export class Display {
    getElement(): HTMLElement;
  }

  export class Client {
    constructor(tunnel: WebSocketTunnel);
    connect(data: string): void;
    disconnect(): void;
    getDisplay(): Display;
    sendMouseState(mouseState: MouseState): void;
    sendKeyEvent(pressed: 0 | 1, keysym: number): void;
    sendSize(width: number, height: number): void;
    onerror: ((status?: Status) => void) | null;
    onstatechange: ((state: number) => void) | null;
    static State: {
      IDLE: number;
      CONNECTING: number;
      WAITING: number;
      CONNECTED: number;
      DISCONNECTING: number;
      DISCONNECTED: number;
    };
  }

  export class Mouse {
    constructor(element: HTMLElement);
    onmousedown: ((mouseState: MouseState) => void) | null;
    onmouseup: ((mouseState: MouseState) => void) | null;
    onmousemove: ((mouseState: MouseState) => void) | null;
    onmousewheel: ((mouseState: MouseState) => void) | null;
  }

  export class Keyboard {
    constructor(element: HTMLElement);
    onkeydown: ((keysym: number) => void | boolean) | null;
    onkeyup: ((keysym: number) => void) | null;
  }

  const Guacamole: {
    WebSocketTunnel: typeof WebSocketTunnel;
    Client: typeof Client;
    Mouse: typeof Mouse;
    Keyboard: typeof Keyboard;
  };

  export default Guacamole;
}

