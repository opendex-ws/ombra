<script lang="ts">
	import { api } from '$lib/api/client';
	import type { ErrorResponse } from '$lib/api/types';

	let { onsuccess = () => {} }: { onsuccess?: () => void } = $props();

	let phoneInput = $state('');
	let codeInput = $state('');
	let passwordInput = $state('');
	let step = $state<'phone' | 'code'>('phone');
	let error = $state('');
	let submitting = $state(false);
	let needsPassword = $state(false);

	async function login() {
		if (!phoneInput.trim()) return;
		submitting = true;
		error = '';
		try {
			const { data, error: err } = await api.POST('/v2/watchlist/manage/tg/login/start', {
				body: { phoneNumber: phoneInput.trim() }
			});
			if (err) throw new Error((err as ErrorResponse)?.message ?? 'Failed to send code');
			if (data?.message === 'LOGIN_SUCCESS') {
				onsuccess();
			} else {
				step = 'code';
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to start login';
		} finally {
			submitting = false;
		}
	}

	async function verify() {
		if (!codeInput.trim()) return;
		submitting = true;
		error = '';
		try {
			const { data, error: err } = await api.POST('/v2/watchlist/manage/tg/login/complete', {
				body: {
					phoneNumber: phoneInput.trim(),
					code: codeInput.trim(),
					...(passwordInput ? { cloudPassword: passwordInput } : {})
				}
			});
			if (err) {
				const msg = (err as ErrorResponse)?.message ?? '';
				if (msg.toLowerCase().includes('password')) {
					needsPassword = true;
					throw new Error('Two-factor password required');
				}
				throw new Error(msg || 'Verification failed');
			}
			if (data?.message === 'LOGIN_SUCCESS') {
				onsuccess();
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Verification failed';
		} finally {
			submitting = false;
		}
	}
</script>

{#if step === 'phone'}
	<div class="space-y-3">
		<div>
			<label class="mb-1 block text-xs text-g7" for="tg-phone-form">Phone Number</label>
			<input
				id="tg-phone-form"
				type="tel"
				placeholder="+1234567890"
				bind:value={phoneInput}
				onkeydown={(e) => e.key === 'Enter' && login()}
				class="w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-base text-tx placeholder-g4 outline-none focus:border-grn"
			/>
		</div>
		<button onclick={login} disabled={submitting || !phoneInput.trim()} class="btn-primary w-full px-6 py-2 text-sm">
			{submitting ? 'Sending...' : 'Send Code'}
		</button>
	</div>
{:else if step === 'code'}
	<div class="space-y-3">
		<div class="rounded-lg border border-grn/20 bg-grn/10 px-3 py-2 text-xs text-grn">
			Code sent to {phoneInput}
		</div>
		<div>
			<label class="mb-1 block text-xs text-g7" for="tg-code-form">Verification Code</label>
			<input
				id="tg-code-form"
				type="text"
				placeholder="12345"
				bind:value={codeInput}
				onkeydown={(e) => e.key === 'Enter' && verify()}
				class="w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-base text-tx placeholder-g4 outline-none focus:border-grn"
			/>
		</div>
		{#if needsPassword}
			<div>
				<label class="mb-1 block text-xs text-g7" for="tg-pass-form">Two-Factor Password</label>
				<input
					id="tg-pass-form"
					type="password"
					placeholder="Cloud password"
					bind:value={passwordInput}
					onkeydown={(e) => e.key === 'Enter' && verify()}
					class="w-full rounded-lg border border-bd bg-s4 px-3 py-2 text-base text-tx placeholder-g4 outline-none focus:border-grn"
				/>
			</div>
		{/if}
		<div class="flex items-center gap-2">
			<button onclick={verify} disabled={submitting || !codeInput.trim()} class="btn-primary flex-1 px-6 py-2 text-sm">
				{submitting ? 'Verifying...' : 'Verify'}
			</button>
			<button onclick={() => { step = 'phone'; codeInput = ''; error = ''; needsPassword = false; passwordInput = ''; }} class="btn-secondary px-4 py-2 text-sm">
				Back
			</button>
		</div>
	</div>
{/if}

{#if error}
	<div class="mt-3 text-xs text-red">{error}</div>
{/if}
