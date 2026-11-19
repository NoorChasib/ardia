#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

BOOL NillaFieldTimingEnabled(void);
double NillaFieldNow(void);
void NillaFieldMark(NSString *_Nullable key, NSString *kind, double at);
void NillaFieldMarkNow(NSString *_Nullable key, NSString *kind);
void NillaFieldMarkAtCommit(NSString *_Nullable key, NSString *kind);
void NillaWebViewsSetFieldTiming(BOOL on);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
