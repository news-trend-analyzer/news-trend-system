import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { CoupangAffiliateService } from './coupang-affiliate.service';
import { CreateCoupangDeeplinkDto } from './dto/create-coupang-deeplink.dto';

@Controller('trend/affiliate/coupang')
@UseInterceptors(ClassSerializerInterceptor)
export class CoupangAffiliateController {
  constructor(private readonly coupangAffiliateService: CoupangAffiliateService) {}

  @Post('deeplink')
  async createDeeplink(@Body() body: CreateCoupangDeeplinkDto) {
    return this.coupangAffiliateService.createDeeplink(body.query);
  }
}
