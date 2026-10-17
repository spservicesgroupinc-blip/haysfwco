import { workspaceApi } from '../../services/workspaceApi';
import type { CustomerReference, CustomerReferenceSnapshot } from './customerReference';

async function referenceRequest(action: string, payload: Record<string, unknown> = {}): Promise<CustomerReferenceSnapshot> {
  try {
    const result = await workspaceApi<{ reference: CustomerReferenceSnapshot }>(action, payload);
    const reference = result?.reference;
    if (!reference || !Array.isArray(reference.customers) || typeof reference.updatedAt !== 'string') {
      throw new Error('The database returned an invalid customer reference.');
    }
    return reference;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'unknown_action') {
      throw new Error('Customer knowledge base support needs the latest Apps Script deployment. The shared list has not been changed.');
    }
    throw error;
  }
}

/** Refresh from the shared backend; directory imports are a separate service. */
export const getCustomerReference = () => referenceRequest('getCustomerReference');
export const replaceCustomerReference = (customers: CustomerReference[], fileName: string) =>
  referenceRequest('replaceCustomerReference', { customers, fileName });
