import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  MaxAdContentRating,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';

const REWARDED_4K_AD_UNIT_ID = 'ca-app-pub-6635734723067997/8257024223';
const rewardedAdUnitId = __DEV__ ? TestIds.REWARDED : REWARDED_4K_AD_UNIT_ID;

let initialization: Promise<boolean> | null = null;
let consentPreparation: Promise<boolean> | null = null;

export function prepareAdConsent() {
  if (consentPreparation) return consentPreparation;

  consentPreparation = AdsConsent.gatherConsent({
    tagForUnderAgeOfConsent: false,
  })
    .then(consent => consent.canRequestAds)
    .catch(async () => {
      try {
        const previousConsent = await AdsConsent.getConsentInfo();
        return previousConsent.canRequestAds;
      } catch {
        consentPreparation = null;
        return false;
      }
    });

  return consentPreparation;
}

export type AdPrivacyOptionsResult = 'shown' | 'not-required' | 'unavailable';

export async function showAdPrivacyOptions(): Promise<AdPrivacyOptionsResult> {
  try {
    const consent = await AdsConsent.requestInfoUpdate({
      tagForUnderAgeOfConsent: false,
    });
    if (
      consent.privacyOptionsRequirementStatus !==
      AdsConsentPrivacyOptionsRequirementStatus.REQUIRED
    ) {
      return 'not-required';
    }

    await AdsConsent.showPrivacyOptionsForm();
    consentPreparation = null;
    initialization = null;
    return 'shown';
  } catch {
    return 'unavailable';
  }
}

async function initializeAds() {
  if (initialization) return initialization;

  initialization = (async () => {
    try {
      await mobileAds().setRequestConfiguration({
        maxAdContentRating: MaxAdContentRating.PG,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });

      if (!(await prepareAdConsent())) return false;

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
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;
    const subscriptions: Array<() => void> = [];

    const finish = (result: Rewarded4KResult) => {
      if (settled) return;
      settled = true;
      if (loadTimeout) clearTimeout(loadTimeout);
      subscriptions.forEach(unsubscribe => unsubscribe());
      resolve(result);
    };

    loadTimeout = setTimeout(() => finish('unavailable'), 45000);

    subscriptions.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        if (loadTimeout) {
          clearTimeout(loadTimeout);
          loadTimeout = null;
        }
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
