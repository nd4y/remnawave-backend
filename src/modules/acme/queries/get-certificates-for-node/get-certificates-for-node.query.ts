/**
 * Certificate material for one node, ready to be injected into the config it is
 * about to receive.
 */
export interface INodeCertificate {
    /** PEM chain split into lines, the shape Xray expects inline. */
    certificate: string[];
    /** Subject common name; used to find the entry to replace on the inbound. */
    commonName: string;
    fingerprint: string;
    /** Empty means every TLS inbound of the node. */
    inboundTags: string[];
    key: string[];
}

export class GetCertificatesForNodeQuery {
    constructor(public readonly nodeUuid: string) {}
}
