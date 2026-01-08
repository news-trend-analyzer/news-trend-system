import { Controller } from '@nestjs/common';
import { AnalyzerService } from './analyzer.service';

@Controller('analyzer')
export class AnalyzerController {
  constructor(private readonly analyzerService: AnalyzerService) {}
}







