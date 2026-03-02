import type { SubscriptionResolver, TRPCResolverDef } from "@trpc/client"
import { Observable } from "rxjs"

export function fromTRPCSubscription<TDef extends TRPCResolverDef>(subscription: { subscribe: SubscriptionResolver<TDef> }, input: TDef["input"]) {
	return new Observable<TDef["output"] extends AsyncIterable<infer U> ? U : TDef["output"]>((subscriber) => {
		return subscription.subscribe(input, {
			onData: (value) => subscriber.next(value),
			onError: (err) => subscriber.error(err),
			onComplete: () => subscriber.complete()
		})
	})
}
