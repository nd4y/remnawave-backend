import axios, { AxiosInstance, isAxiosError } from 'axios';

import { IAcmeProxyCredentialPayload } from '../../interfaces/credential-payload.interface';
import { IDnsSolver, IDnsSolverDescription } from './solver.interface';

// Cloudflare has been observed taking 30+ seconds on a single record write;
// 15s produced spurious ERRORs during the production migration.
const REQUEST_TIMEOUT_MS = 60_000;

interface IPolicyResponse {
    allow: string[];
    provider: { name: string; type: string; zones: string[] };
}

/**
 * Talks to an acme-proxy instance. The proxy owns the DNS provider credentials
 * and the domain policy; this side only knows a base URL and a client token.
 */
export class AcmeProxySolver implements IDnsSolver {
    public readonly canPublish = true;

    private readonly client: AxiosInstance;

    constructor(payload: IAcmeProxyCredentialPayload) {
        this.client = axios.create({
            baseURL: payload.baseUrl,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                Authorization: `Bearer ${payload.token}`,
                'Content-Type': 'application/json',
            },
        });
    }

    public async present(fqdn: string, value: string): Promise<void> {
        await this.request('post', '/v1/dns-01/present', { fqdn, value });
    }

    public async cleanup(fqdn: string, value: string): Promise<void> {
        await this.request('post', '/v1/dns-01/cleanup', { fqdn, value });
    }

    public async publishPersist(fqdn: string, value: string): Promise<void> {
        await this.request('put', '/v1/persist', { fqdn, value });
    }

    public async describe(): Promise<IDnsSolverDescription> {
        try {
            const { data } = await this.client.get<IPolicyResponse>('/v1/policy');

            return {
                isOk: true,
                message: `Proxy reachable, provider "${data.provider.name}" (${data.provider.type})`,
                allow: data.allow ?? [],
                zones: data.provider?.zones ?? [],
            };
        } catch (error) {
            return {
                isOk: false,
                message: this.describeError(error),
                allow: [],
                zones: [],
            };
        }
    }

    private async request(
        method: 'post' | 'put',
        path: string,
        body: Record<string, string>,
    ): Promise<void> {
        try {
            await this.client.request({ method, url: path, data: body });
        } catch (error) {
            throw new Error(this.describeError(error));
        }
    }

    /**
     * acme-proxy answers with a machine code and a message; surfacing both makes
     * "the domain is not in the allow list" readable in the certificate log
     * instead of a bare 403.
     */
    private describeError(error: unknown): string {
        if (isAxiosError(error)) {
            const data = error.response?.data as undefined | { error?: string; message?: string };

            if (data?.error) {
                return `acme-proxy: ${data.error}: ${data.message ?? ''}`.trim();
            }

            return `acme-proxy: ${error.message}`;
        }

        return `acme-proxy: ${String(error)}`;
    }
}
