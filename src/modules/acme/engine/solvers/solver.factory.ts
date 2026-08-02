import { Injectable } from '@nestjs/common';

import { ACME_PROVIDER } from '@libs/contracts/constants';

import { AcmeSecretBoxService } from '../../crypto/acme-secret-box.service';
import { AcmeCredentialEntity } from '../../entities';
import {
    IAcmeProxyCredentialPayload,
    ICloudflareCredentialPayload,
} from '../../interfaces/credential-payload.interface';
import { AcmeProxySolver } from './acme-proxy.solver';
import { CloudflareSolver } from './cloudflare.solver';
import { ManualSolver } from './manual.solver';
import { IDnsSolver } from './solver.interface';

@Injectable()
export class SolverFactory {
    constructor(private readonly secretBox: AcmeSecretBoxService) {}

    public create(credential: AcmeCredentialEntity): IDnsSolver {
        switch (credential.provider) {
            case ACME_PROVIDER.ACME_PROXY:
                return new AcmeProxySolver(
                    this.readPayload<IAcmeProxyCredentialPayload>(credential),
                );
            case ACME_PROVIDER.CLOUDFLARE:
                return new CloudflareSolver(
                    this.readPayload<ICloudflareCredentialPayload>(credential),
                );
            case ACME_PROVIDER.MANUAL:
                return new ManualSolver();
            default:
                throw new Error(`Unsupported ACME credential provider: ${credential.provider}`);
        }
    }

    private readPayload<T>(credential: AcmeCredentialEntity): T {
        if (!credential.payloadEncrypted) {
            throw new Error(`Credential "${credential.name}" has no stored secret`);
        }

        return this.secretBox.decryptJson<T>(credential.payloadEncrypted);
    }
}
