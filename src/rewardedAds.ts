import mobileAds, {
  AdEventType,
  AdsConsent,
  MaxAdContentRating,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

const REWARDED_4K_AD_UNIT_ID = 'ca-app-pub-6635734723067997/8257024223';
const rewardedAdUnitId = __DEV__ ? TestIds.REWARDED : REWARDED_4K_AD_UNIT_ID;

let initialization: Promise<boolean> | null = null;

async function initializeAds() {
  if (initialization) return initialization;

  initialization = (async () => {
    try {
      await mobileAds().setRequestConfiguration({
        maxAdContentRating: MaxAdContentRating.PG,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });

      const consent = await AdsConsent.gatherConsent({
        tagForUnderAgeOfConsent: false,
      });
      if (!consent.canRequestAds) return false;

      await mobileAds().initialize();
      return true;
    } catch {
      initialization = null;
      return false;
    }
  })();

  return initialization;
}

export type Rewarded4KResult = 'earned' | 'closed' | 'unavailable';

export async function watchRewardedAdFor4K(): Promise<Rewarded4KResult> {
  if (!(await initializeAds())) return 'unavailable';

  return new Promise(resolve => {
    const ad = RewardedAd.createForAdRequest(rewardedAdUnitId, {
      requestNonPersonalizedAdsOnly: true,
    });
    let earned = false;
    let settled = false;
    const subscriptions: Array<() => void> = [];

    const finish = (result: Rewarded4KResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscriptions.forEach(unsubscribe => unsubscribe());
      resolve(result);
    };

    const timeout = setTimeout(() => finish('unavailable'), 30000);

    subscriptions.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        ad.show().catch(() => finish('unavailable'));
      }),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        finish(earned ? 'earned' : 'closed');
      }),
      ad.addAdEventListener(AdEventType.ERROR, () => {
        finish('unavailable');
      }),
    );

    ad.load();
  });
}
