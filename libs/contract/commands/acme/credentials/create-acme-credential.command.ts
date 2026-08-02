import { z } from 'zod';

import { ACME_ROUTES, REST_API } from '../../../api';
import { ACME_PROVIDER, ACME_PROVIDERS, getEndpointDetails } from '../../../constants';
import { AcmeCredentialSchema } from '../../../models';

export namespace CreateAcmeCredentialCommand {
    export const url = REST_API.ACME.CREDENTIALS.CREATE;
    export const TSQ_url = url;

    export const endpointDetails = getEndpointDetails(
        ACME_ROUTES.CREDENTIALS.CREATE,
        'post',
        'Create ACME credential',
        { scope: 'create-credential', kind: 'write' },
    );

    export const RequestBodySchema = z
        .object({
            name: z
                .string()
                .min(2, 'Name must be at least 2 characters')
                .max(40, 'Name must be less than 40 characters')
                .regex(
                    /^[A-Za-z0-9_\s-]+$/,
                    'Name can only contain letters, numbers, underscores, dashes and spaces',
                ),
            provider: z.enum(ACME_PROVIDERS),

            /** acme-proxy: base URL of the proxy, e.g. http://acme-proxy:8080 */
            baseUrl: z.optional(z.url()),
            /** acme-proxy: the client token issued by the proxy. */
            token: z.optional(z.string().min(1)),

            /** Cloudflare: an API token with Zone:Read and DNS:Edit. */
            apiToken: z.optional(z.string().min(1)),
        })
        .superRefine((data, ctx) => {
            if (data.provider === ACME_PROVIDER.ACME_PROXY) {
                if (!data.baseUrl) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['baseUrl'],
                        message: 'baseUrl is required for ACME_PROXY credentials',
                    });
                }

                if (!data.token) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['token'],
                        message: 'token is required for ACME_PROXY credentials',
                    });
                }
            }

            if (data.provider === ACME_PROVIDER.CLOUDFLARE && !data.apiToken) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['apiToken'],
                    message: 'apiToken is required for CLOUDFLARE credentials',
                });
            }
        });

    export const ResponseSchema = z.object({
        response: AcmeCredentialSchema,
    });

    export type RequestBody = z.infer<typeof RequestBodySchema>;
    export type Response = z.infer<typeof ResponseSchema>;
}
