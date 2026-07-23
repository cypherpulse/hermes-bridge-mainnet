export interface ClaimResponse {
  success?: boolean;
  message?: string;
  txId?: string;
  explorerUrl?: string;
  error?: string;
}

export const claimUsdcx = async (address: string): Promise<ClaimResponse> => {
  const apiKey = import.meta.env.VITE_FAUCET_API_KEY;
  const rawApiUrl = import.meta.env.VITE_FAUCET_API_URL;
  
  // Ensure we have a valid URL and trim any accidental spaces
  const apiUrl = rawApiUrl?.trim();

  if (!apiUrl || apiUrl.includes('undefined')) {
    return { error: 'Faucet API configuration is missing. Please contact support.' };
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ address }),
    });

    // Handle rate limiting specifically
    if (response.status === 429) {
      try {
        const data = await response.json();
        return { error: data.error || 'You have reached the rate limit. Please try again later.' };
      } catch (e) {
        return { error: 'You can only claim once every 24 hours. Please try again later.' };
      }
    }

    const data = await response.json();

    if (!response.ok) {
      // Handle specific error messages as requested
      if (data.error && data.error.toLowerCase().includes('insufficient balance')) {
        return { error: 'Insufficient balance in the faucet Vault' };
      }
      return { error: data.error || 'Failed to claim USDCx' };
    }

    return data;
  } catch (error) {
    // Silently handle connection errors to avoid exposing API details in console logs
    return { error: 'Failed to connect to faucet service. Please try again later.' };
  }
};
