declare module "pose-format" {
  export class Pose {
    static fromRemote(url: string): Promise<any>;
    static from(buffer: ArrayBuffer | Uint8Array): Promise<any>;

    header: any;
    body: any;
  }
}
