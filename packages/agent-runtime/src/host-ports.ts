import type {
  RuntimeSessionHost,
  VerificationInspectReply,
  VerificationInspectRequest,
  VerificationCancelRequest,
  RuntimeRpcRequest,
  RuntimeRpcReply,
  RuntimeModelRpcRequest,
  RuntimeModelRpcReply,
} from '@skaro/timeline';
import { VerificationServer } from './verification/ipc-host.ts';
import { ExtensionServer } from './extensions/ipc-host.ts';
import { ModelServer } from './models/ipc-host.ts';

type Request =
  | VerificationInspectRequest
  | VerificationCancelRequest
  | RuntimeRpcRequest
  | RuntimeModelRpcRequest;
type Reply = VerificationInspectReply | RuntimeRpcReply | RuntimeModelRpcReply;
export class RuntimeHostServer {
  private readonly verification?: VerificationServer;
  private readonly extensions?: ExtensionServer;
  private readonly model?: ModelServer;
  private closing?: Promise<void>;
  constructor(
    host: RuntimeSessionHost,
    send: (reply: Reply) => void,
    requireOwner: (signal: AbortSignal) => Promise<void>,
  ) {
    if (host.verification)
      this.verification = new VerificationServer(host.verification, send, requireOwner);
    if (host.extensions) this.extensions = new ExtensionServer(host.extensions, send, requireOwner);
    if (host.model) this.model = new ModelServer(host.model, send, requireOwner);
  }
  receive(request: Request): void {
    if (request.type === 'verification-inspect' || request.type === 'verification-cancel') {
      if (!this.verification) throw new Error('Unconfigured verification host');
      this.verification.receive(request);
    } else if (request.type === 'model-rpc-call' || request.type === 'model-rpc-cancel') {
      if (!this.model) throw new Error('Unconfigured model host');
      this.model.receive(request);
    } else {
      if (!this.extensions) throw new Error('Unconfigured extension host');
      this.extensions.receive(request);
    }
  }
  close(): Promise<void> {
    this.verification?.close();
    return (this.closing ??= (async () => {
      const results = await Promise.allSettled([this.extensions?.close(), this.model?.close()]);
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Host port shutdown was not confirmed');
    })());
  }
}
